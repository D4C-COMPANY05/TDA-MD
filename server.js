// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const QRCode = require('qrcode');
const http = require('http');
const { Server } = require('socket.io');
const {
  default: makeWASocket,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const admin = require('firebase-admin');

// --- Firebase ---
let serviceAccount;
try {
  // Tente de charger la configuration depuis les variables d'environnement
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    // Sinon, charge le fichier local pour le développement
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

// --- Auth Baileys depuis Firestore ---
// L'ID de session est crucial car il sert de clé pour stocker les informations
// de la session WhatsApp dans Firestore, associant la connexion à un utilisateur unique.
async function getAuthFromFirestore(sessionId) {
  // Le chemin du document est 'artifacts/tda/sessions/{sessionId}'
  const sessionDocRef = db.collection('artifacts').doc('tda').collection('sessions').doc(sessionId);
  let creds = {};
  const doc = await sessionDocRef.get();
  if (doc.exists) {
    creds = doc.data();
    console.log(`[Firestore] Fichier de session trouvé pour: ${sessionId}`);
  } else {
    console.log(`[Firestore] Nouveau fichier de session créé pour: ${sessionId}`);
  }

  // Fonction pour sauvegarder les nouvelles informations d'identification dans Firestore
  const saveCreds = async (newCreds) => {
    Object.assign(creds, newCreds);
    await sessionDocRef.set(creds);
  };

  return { state: { creds, saveCreds } };
}

// --- Gestion des connexions Socket.IO ---
io.on('connection', (socket) => {
  console.log('Client connecté: ', socket.id);

  socket.on('startPair', async ({ sessionId }) => {
    console.log(`[Socket.IO] 'startPair' reçu pour session ID: ${sessionId}`);
    if (!sessionId) {
      // L'ID de session est requis pour associer le QR code à un utilisateur.
      return socket.emit('error', 'ID de session requis.');
    }

    try {
      const { state } = await getAuthFromFirestore(sessionId);
      const { version } = await fetchLatestBaileysVersion();
      console.log(`[Baileys] Version: ${version}. Initialisation de la session.`);

      const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['TDA - The Dread Alliance', 'Chrome', '1.0'],
        mobile: false
      });

      sock.ev.on('creds.update', state.saveCreds);

      // --- Événements Baileys ---
      sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
          // Si un QR code est généré, on l'envoie au client
          QRCode.toDataURL(qr, (err, url) => {
            if (err) {
              return socket.emit('error', 'Erreur génération QR code.');
            }
            socket.emit('qrCode', url);
            console.log(`[Baileys] QR code généré pour session ID: ${sessionId}`);
          });
        }

        if (connection === 'open') {
          // Connexion réussie, on envoie un message au client
          socket.emit('connected', 'Bot connecté avec succès!');
          console.log(`[Baileys] Connexion ouverte pour session ID: ${sessionId}`);
        }

        if (connection === 'close') {
          // Connexion fermée, on envoie un message d'erreur au client
          const reason = lastDisconnect?.error?.output?.payload?.message || "Erreur inconnue";
          socket.emit('error', `Connexion fermée: ${reason}`);
          console.log(`[Baileys] Connexion fermée pour session ID: ${sessionId}. Raison: ${reason}`);
        }
      });

      // --- Nettoyage socket côté serveur ---
      socket.on('disconnect', () => {
        sock?.end?.();
        console.log(`Client déconnecté: ${socket.id}`);
      });

    } catch (e) {
      console.error('[Erreur serveur Baileys]', e);
      socket.emit('error', 'Erreur lors de l’initialisation de la session. Veuillez réessayer.');
    }
  });
});

// --- Lancement serveur ---
server.listen(port, () => {
  console.log(`Serveur TDA d’appariement démarré sur le port ${port}`);
});

