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
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    serviceAccount = require('./firebase-service-account.json');
  }
} catch (error) {
  console.error("Erreur Firebase: ", error);
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

// --- Gestion des connexions Socket.IO ---
io.on('connection', (socket) => {
  console.log('Client connecté: ', socket.id);

  socket.on('startPair', async ({ sessionId, mode, phoneNumber }) => {
    console.log(`[Socket.IO] startPair reçu: ${sessionId}, mode: ${mode}, numéro: ${phoneNumber}`);
    if (!sessionId) return socket.emit('error', 'ID de session requis.');

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
        mobile: false // Forcer le mode navigateur car l'API mobile est obsolète
      });

      sock.ev.on('creds.update', state.saveCreds);

      // --- Pairing code ---
      if (mode === 'code') {
        if (!phoneNumber) return socket.emit('error', 'Numéro requis pour pairing code.');
        try {
          // La méthode requestPairingCode fonctionne en mode navigateur
          const code = await sock.requestPairingCode(phoneNumber);
          socket.emit('pairingCode', code);
        } catch (err) {
          console.error('[Erreur] Impossible de générer le code d’appariement: ', err);
          socket.emit('error', 'Impossible de générer le code d’appariement.');
        }
      }

      // --- QR code ---
      sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
          QRCode.toDataURL(qr, (err, url) => {
            if (err) return socket.emit('error', 'Erreur génération QR code.');
            socket.emit('qrCode', url);
          });
        }

        if (connection === 'open') {
          socket.emit('connected', 'Bot connecté avec succès!');
        }

        if (connection === 'close') {
          const reason = lastDisconnect?.error?.output?.payload?.message || "Erreur inconnue";
          socket.emit('error', `Connexion fermée: ${reason}`);
        }
      });

      // --- Cleanup socket côté serveur ---
      socket.on('disconnect', () => {
        sock?.end?.();
        console.log(`Client déconnecté: ${socket.id}`);
      });

    } catch (e) {
      console.error('[Erreur serveur Baileys]', e);
      socket.emit('error', 'Erreur lors de l’initialisation de la session.');
    }
  });
});

// --- Lancement serveur ---
server.listen(port, () => {
  console.log(`Serveur TDA d’appariement démarré sur le port ${port}`);
});

