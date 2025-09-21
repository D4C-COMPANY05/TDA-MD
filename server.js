// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, PORT } = require('./config');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 25000,
  pingTimeout: 60000
});

const logger = pino({ level: 'info' });

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('Serveur TDA-MD en cours d’exécution.');
});

// Initialisation Firebase Admin
const serviceAccount = {
  projectId: FIREBASE_PROJECT_ID,
  clientEmail: FIREBASE_CLIENT_EMAIL,
  privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK initialisé.');
} catch (error) {
  console.error('Erreur init Firebase Admin SDK:', error.message);
}

const db = admin.firestore();
const sessions = new Map();

// Fonction de démarrage de session Baileys
async function startSession(phoneNumber, userId, socket) {
  // Supprimer session existante
  if (sessions.has(phoneNumber)) {
    sessions.get(phoneNumber).sock.ev.removeAllListeners();
    sessions.delete(phoneNumber);
  }

  const sessionDir = `./sessions/${phoneNumber}`;
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
    logger.info(`[Session] Nouveau dossier créé pour ${phoneNumber}`);
  } else {
    logger.info(`[Session] Reconnexion pour ${phoneNumber}`);
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    logger: logger.child({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['TDA-MD', 'Chrome', '1.0']
  });

  sessions.set(phoneNumber, { sock, state, saveCreds, phoneNumber, userId });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrCodeDataURL = await qrcode.toDataURL(qr);
        socket.emit('qrcode', { qrCodeDataURL });
        logger.info(`[QR] QR Code généré pour ${phoneNumber}`);
      } catch (e) {
        logger.error(`[QR] Erreur génération QR: ${e}`);
        socket.emit('error', { message: 'Erreur lors de la génération du QR code.' });
      }
    }

    if (connection === 'open') {
      await db.collection('bots').doc(phoneNumber).set({
        userId,
        phoneNumber,
        status: 'connecté',
        lastSeen: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // message de bienvenue
      try {
        await sock.sendMessage(phoneNumber + '@s.whatsapp.net', {
          text: `*🤖 Bot TDA-MD connecté !*\n\nBienvenue ! Je suis en ligne et prêt à recevoir des commandes.`
        });
      } catch (e) {
        logger.warn(`[Bot] Impossible d’envoyer le message de bienvenue: ${e}`);
      }

      logger.info(`[Bot] Bot connecté pour ${phoneNumber}`);
      socket.emit('pairing-success', { message: 'Bot connecté avec succès!' });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        logger.error(`[Bot] Déconnecté, reconnexion…`);
        startSession(phoneNumber, userId, socket);
      } else {
        logger.warn(`[Bot] Session terminée pour ${phoneNumber}`);
        socket.emit('error', { message: 'Session expirée. Veuillez scanner un nouveau QR code.' });
        sessions.delete(phoneNumber);
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          logger.info(`[Session] Dossier supprimé pour ${phoneNumber}`);
        } catch (e) {
          logger.error(`[Session] Erreur suppression dossier: ${e}`);
        }
      }
      // maj statut Firestore
      await db.collection('bots').doc(phoneNumber).set({
        status: 'déconnecté',
        lastSeen: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // log messages entrants
  sock.ev.on('messages.upsert', async (m) => {
    if (m.messages[0].key.remoteJid === 'status@broadcast') return;
    const message = m.messages[0];
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    logger.info(`[Message] Message reçu de ${message.key.remoteJid}: ${text}`);
  });
}

io.on('connection', (socket) => {
  logger.info(`[socket] Client connecté: ${socket.id}`);

  // on écoute le même event que côté front
  socket.on('request-qrcode', (data) => {
    const { phoneNumber, userId } = data;
    if (!phoneNumber || !userId) {
      socket.emit('error', { message: 'Numéro ou ID utilisateur manquant.' });
      return;
    }
    startSession(phoneNumber, userId, socket).catch(e => {
      logger.error(`[Serveur] Erreur couplage: ${e}`);
      socket.emit('error', { message: 'Erreur interne du serveur lors du couplage.' });
    });
  });

  socket.on('disconnect', (reason) => {
    logger.info(`[socket] Client déconnecté: ${socket.id} (${reason})`);
  });
});

server.listen(PORT, () => {
  logger.info(`Serveur en cours d’exécution sur le port ${PORT}`);
});