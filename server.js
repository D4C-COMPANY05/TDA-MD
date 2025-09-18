// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const http = require('http');
const { Server } = require('socket.io');
const {
  default: makeWASocket,
  fetchLatestBaileysVersion
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
  console.error("Erreur Firebase: Impossible de charger le compte de service.", error);
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
  const sessionDocRef = db.collection('sessions').doc(sessionId);

  let creds = {};
  try {
    const doc = await sessionDocRef.get();
    if (doc.exists) {
      creds = doc.data();
      console.log(`[Firestore] Session trouvée pour: ${sessionId}`);
    } else {
      console.log(`[Firestore] Nouvelle session pour: ${sessionId}`);
    }
  } catch (error) {
    console.error(`[Firestore] Erreur récupération session: ${error}`);
  }

  const saveCreds = async (newCreds) => {
    try {
      await sessionDocRef.set(newCreds);
      console.log(`[Firestore] Données de connexion sauvegardées: ${sessionId}`);
    } catch (error) {
      console.error(`[Firestore] Erreur sauvegarde: ${error}`);
    }
  };

  return { creds, saveCreds };
}

async function startBaileysSession(sessionId, connectionType, phoneNumber) {
  try {
    const authState = await getAuthFromFirestore(sessionId);
    const { version } = await fetchLatestBaileysVersion();
    console.log(`[Baileys] Version: ${version}. Initialisation.`);

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'info' }),
      printQRInTerminal: false,
      auth: authState,
      browser: ['Ubuntu Linux', 'Chrome', '1.0']
    });

    sock.ev.on('creds.update', authState.saveCreds);

    // QR code
    if (connectionType === 'qr') {
      sock.ev.on('connection.update', (update) => {
        if (update.qr) {
          QRCode.toDataURL(update.qr, (err, url) => {
            if (err) return io.to(sessionId).emit('error', 'Erreur QR code.');
            io.to(sessionId).emit('qrCode', url);
            console.log(`[Baileys] QR code généré pour: ${sessionId}`);
          });
        }
      });
    }

    // Pairing code
    if (connectionType === 'pairing' && phoneNumber) {
      const code = await sock.requestPairingCode(phoneNumber);
      io.to(sessionId).emit('pairingCode', code);
      console.log(`[Baileys] Code d'appariement généré: ${code} pour: ${sessionId}`);
    }

    sock.ev.on('connection.update', (update) => {
      if (update.connection === 'open') {
        io.to(sessionId).emit('connected', 'Bot connecté avec succès!');
        console.log(`[Baileys] Connexion ouverte: ${sessionId}`);
      }
      if (update.connection === 'close') {
        const reason = update.lastDisconnect?.error?.output?.payload?.message || "Erreur inconnue";
        io.to(sessionId).emit('error', `Connexion fermée: ${reason}`);
        console.error(`[Baileys] Connexion fermée pour: ${sessionId}`, update.lastDisconnect?.error);
        sock?.end();
      }
    });

    return sock;

  } catch (e) {
    console.error('[Erreur serveur Baileys]', e);
    io.to(sessionId).emit('error', 'Erreur lors de l’initialisation de la session.');
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
    console.log(`[Socket.IO] 'startQR' reçu. Session: ${sessionId}`);
    if (activeSessions.has(sessionId)) {
      activeSessions.get(sessionId)?.end();
      activeSessions.delete(sessionId);
    }
    const sock = await startBaileysSession(sessionId, 'qr');
    if (sock) activeSessions.set(sessionId, sock);
  });

  socket.on('startPairingCode', async ({ phoneNumber }) => {
    const sessionId = uuidv4();
    socket.join(sessionId);
    console.log(`[Socket.IO] 'startPairingCode' reçu. Session: ${sessionId}`);
    if (activeSessions.has(sessionId)) {
      activeSessions.get(sessionId)?.end();
      activeSessions.delete(sessionId);
    }
    const sock = await startBaileysSession(sessionId, 'pairing', phoneNumber);
    if (sock) activeSessions.set(sessionId, sock);
  });

  socket.on('disconnect', () => {
    for (const [sessionId, sock] of activeSessions.entries()) {
      const socketsInRoom = io.sockets.adapter.rooms.get(sessionId);
      if (!socketsInRoom || socketsInRoom.size === 0) {
        sock?.end();
        activeSessions.delete(sessionId);
        console.log(`Session fermée (déconnexion client): ${sessionId}`);
      }
    }
    console.log(`Client déconnecté: ${socket.id}`);
  });
});

// --- Lancement serveur ---
server.listen(port, () => {
  console.log(`Serveur TDA d’appariement démarré sur le port ${port}`);
});