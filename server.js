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

  socket.on('startPair', async ({ sessionId, uid }) => {
    console.log(`[Socket.IO] startPair reçu pour session ID: ${sessionId}, UID: ${uid}`);
    if (!sessionId || !uid) return socket.emit('error', 'ID de session et UID requis.');

    try {
      // --- Vérifier que l’UID correspond bien au sessionId ---
      const userSessionRef = db.collection('users').doc(uid).collection('sessions').doc(sessionId);
      const sessionSnap = await userSessionRef.get();
      if (!sessionSnap.exists) {
        return socket.emit('error', 'Session non autorisée.');
      }

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

      // --- QR code ---
      sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
          try {
            const qrData = await QRCode.toDataURL(qr);
            socket.emit('qrCode', qrData);
          } catch (err) {
            console.error("Erreur génération QR:", err);
            socket.emit('error', 'Erreur génération QR code.');
          }
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