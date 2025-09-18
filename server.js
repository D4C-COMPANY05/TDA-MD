// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const http = require('http');
const { Server } = require('socket.io');
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  isJidPairing,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// --- Firebase ---
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    serviceAccount = require('./firebase-service-account.json');
  }
} catch (error) {
  console.error("Erreur Firebase: Impossible de charger le compte de service. Assurez-vous que le fichier ou la variable d'environnement est correct.", error);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- Express ---
const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- HTTP + Socket.IO ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- Authentification Baileys depuis Firestore ---
async function getAuthFromFirestore(sessionId) {
  const sessionDocRef = db.collection('artifacts').doc('tda').collection('users').doc(sessionId).collection('sessions').doc(sessionId);
  let creds = {};
  try {
    const doc = await sessionDocRef.get();
    if (doc.exists) {
      creds = doc.data();
      console.log(`[Firestore] Fichier de session trouvé pour: ${sessionId}`);
    } else {
      console.log(`[Firestore] Nouveau fichier de session créé pour: ${sessionId}`);
    }
  } catch (error) {
    console.error(`[Firestore] Erreur lors de la récupération du document de session: ${error}`);
    return null;
  }

  const saveCreds = async (newCreds) => {
    Object.assign(creds, newCreds);
    try {
      await sessionDocRef.set(creds);
      console.log(`[Firestore] Données de connexion mises à jour pour la session : ${sessionId}`);
    } catch (error) {
      console.error(`[Firestore] Erreur lors de la sauvegarde du document de session: ${error}`);
    }
  };

  return { state: { creds, saveCreds } };
}

async function startBaileysSession(sessionId, connectionType, phoneNumber) {
  try {
    const authState = await getAuthFromFirestore(sessionId);
    if (!authState) {
      io.to(sessionId).emit('error', 'Échec de l\'initialisation de l\'authentification. ID de session manquant ou invalide.');
      return null;
    }
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[Baileys] Version: ${version}. Initialisation de la session.`);

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'info' }),
      printQRInTerminal: false,
      auth: authState.state,
      browser: ['Ubuntu Linux', 'Chrome', '1.0'],
      mobile: false
    });

    sock.ev.on('creds.update', authState.state.saveCreds);

    if (connectionType === 'qr') {
      sock.ev.on('connection.update', (update) => {
        const { qr } = update;
        if (qr) {
          QRCode.toDataURL(qr, (err, url) => {
            if (err) {
              return io.to(sessionId).emit('error', 'Erreur génération QR code.');
            }
            io.to(sessionId).emit('qrCode', url);
            console.log(`[Baileys] QR code généré pour session ID: ${sessionId}`);
          });
        }
      });
    } else if (connectionType === 'pairing') {
      if (phoneNumber && isJidPairing(sock.user?.id)) {
        console.log(`[Baileys] Tentative de connexion avec le code d'appariement pour: ${phoneNumber}`);
        const code = await sock.requestPairingCode(phoneNumber);
        io.to(sessionId).emit('pairingCode', code);
        console.log(`[Baileys] Code d'appariement généré: ${code} pour session ID: ${sessionId}`);
      } else {
        io.to(sessionId).emit('error', 'Connexion impossible. Ce n\'est pas une session de jumelage ou le numéro de téléphone est manquant.');
      }
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        io.to(sessionId).emit('connected', 'Bot connecté avec succès!');
        console.log(`[Baileys] Connexion ouverte pour session ID: ${sessionId}`);
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.payload?.message || "Erreur inconnue";
        io.to(sessionId).emit('error', `Connexion fermée: ${reason}`);
        console.error(`[Baileys] Connexion fermée pour session ID: ${sessionId}. Raison:`, lastDisconnect?.error);
        sock?.end();
      }
    });

    return sock;

  } catch (e) {
    console.error('[Erreur serveur Baileys]', e);
    io.to(sessionId).emit('error', 'Erreur lors de l’initialisation de la session. Veuillez réessayer.');
    return null;
  }
}

// --- Gestion des connexions Socket.IO ---
const activeSessions = new Map();

io.on('connection', (socket) => {
  console.log('Client connecté: ', socket.id);

  socket.on('startQR', async () => {
    const sessionId = uuidv4();
    socket.join(sessionId);
    console.log(`[Socket.IO] 'startQR' reçu. Génération de la session ID: ${sessionId}`);
    if (activeSessions.has(sessionId)) {
      activeSessions.get(sessionId)?.end();
      activeSessions.delete(sessionId);
    }
    const sock = await startBaileysSession(sessionId, 'qr');
    if (sock) {
      activeSessions.set(sessionId, sock);
    }
  });

  socket.on('startPairingCode', async ({ phoneNumber }) => {
    const sessionId = uuidv4();
    socket.join(sessionId);
    console.log(`[Socket.IO] 'startPairingCode' reçu. Génération de la session ID: ${sessionId}`);
    if (activeSessions.has(sessionId)) {
      activeSessions.get(sessionId)?.end();
      activeSessions.delete(sessionId);
    }
    const sock = await startBaileysSession(sessionId, 'pairing', phoneNumber);
    if (sock) {
      activeSessions.set(sessionId, sock);
    }
  });

  socket.on('disconnect', () => {
    for (const [sessionId, sock] of activeSessions.entries()) {
      const socketsInRoom = io.sockets.adapter.rooms.get(sessionId);
      if (!socketsInRoom || socketsInRoom.size === 0) {
        sock?.end();
        activeSessions.delete(sessionId);
        console.log(`Session Baileys fermée en raison de la déconnexion du client pour l'ID: ${sessionId}`);
      }
    }
    console.log(`Client déconnecté: ${socket.id}`);
  });
});

// --- Lancement serveur ---
server.listen(port, () => {
  console.log(`Serveur TDA d’appariement démarré sur le port ${port}`);
});

