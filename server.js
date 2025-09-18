// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const QRCode = require('qrcode');
const WhiskeySocket = require('whiskeysocket');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@adiwajshing/baileys');
const admin = require('firebase-admin');

// --- Firebase ---
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    serviceAccount = require('./firebase-service-account.json');
  }
} catch (error) {
  console.error("Erreur lors du chargement de la clé Firebase:", error);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- Express ---
const app = express();
const port = process.env.PORT || 3000;
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public')); // pour client HTML/JS

// --- WhiskeySocket ---
const server = require('http').createServer(app);
const ws = new WhiskeySocket.Server({ server });

// --- Auth Baileys depuis Firestore ---
async function getAuthFromFirestore(sessionId) {
  const sessionDocRef = db.collection('artifacts').doc('tda').collection('sessions').doc(sessionId);
  let creds = {};
  const doc = await sessionDocRef.get();
  if (doc.exists) creds = doc.data();

  const saveCreds = async (newCreds) => {
    Object.assign(creds, newCreds);
    await sessionDocRef.set(creds);
  };

  return { state: { creds, saveCreds } };
}

// --- Gestion des sockets ---
ws.on('connection', async (socket) => {
  console.log('Client connecté:', socket.id);

  socket.on('startPair', async ({ sessionId, mode, phoneNumber }) => {
    if (!sessionId) return socket.emit('error', 'ID de session requis.');

    try {
      const { state } = await getAuthFromFirestore(sessionId);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['TDA - The Dread Alliance', 'Chrome', '1.0'],
        mobile: mode === 'code'
      });

      sock.ev.on('creds.update', state.saveCreds);

      // --- Pairing code ---
      if (mode === 'code') {
        if (!phoneNumber) return socket.emit('error', 'Numéro requis pour pairing code.');
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          return socket.emit('pairingCode', code);
        } catch (err) {
          console.error('Erreur pairing code:', err);
          return socket.emit('error', 'Impossible de générer le code d’appariement.');
        }
      }

      // --- QR code ---
      sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;

        if (qr) {
          QRCode.toDataURL(qr, (err, url) => {
            if (err) return socket.emit('error', 'Erreur de génération du QR code.');
            socket.emit('qrCode', url);
          });
        }

        if (connection === 'open') {
          socket.emit('connected', 'Bot connecté avec succès!');
        }
      });

    } catch (e) {
      console.error("Erreur du serveur Baileys:", e);
      socket.emit('error', 'Erreur lors de l’initialisation de la session.');
    }
  });
});

// --- Lancement serveur ---
server.listen(port, () => {
  console.log(`Serveur TDA d’appariement démarré sur le port ${port}`);
});