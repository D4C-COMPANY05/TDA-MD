// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const QRCode = require('qrcode');
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
  console.error("Erreur lors du chargement de la clé de service Firebase:", error);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- Express ---
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET','POST'],
  allowedHeaders: ['Content-Type']
}));

// --- Auth Baileys stockée dans Firestore ---
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

// --- Endpoint pair ---
app.post('/pair', async (req, res) => {
  const { sessionId, mode, phoneNumber } = req.body; // mode: 'qr' ou 'code'
  if (!sessionId) return res.status(400).json({ error: 'ID de session requis.' });

  try {
    const { state } = await getAuthFromFirestore(sessionId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: ['TDA - The Dread Alliance', 'Chrome', '1.0'],
      mobile: mode === 'code' // obligatoire pour pairing code
    });

    sock.ev.on('creds.update', state.saveCreds);

    // MODE CODE
    if (mode === 'code') {
      if (!phoneNumber) return res.status(400).json({ error: 'Numéro requis pour pairing code.' });
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        return res.json({ status: 'pairing_code', code });
      } catch (err) {
        console.error('Erreur pairing code:', err);
        return res.status(500).json({ error: 'Impossible de générer le code d’appariement.' });
      }
    }

    // MODE QR
    sock.ev.on('connection.update', (update) => {
      const { connection, qr } = update;

      if (qr) {
        QRCode.toDataURL(qr, (err, url) => {
          if (err) return res.status(500).json({ error: 'Erreur de génération du QR code.' });
          return res.json({ status: 'qr_code', qrCode: url });
        });
      }

      if (connection === 'open') {
        return res.json({ status: 'connected', message: 'Bot connecté avec succès!' });
      }
    });

  } catch (e) {
    console.error("Erreur du serveur Baileys:", e);
    res.status(500).json({ error: 'Une erreur est survenue lors de l’initialisation de la session.' });
  }
});

// --- Lancement ---
app.listen(port, () => {
  console.log(`Serveur TDA d’appariement démarré sur le port ${port}`);
});