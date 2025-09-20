// server.js - Express + Socket.IO minimal avec auth token optionnel
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pino = require('pino');
const { v4: uuidv4 } = require('uuid');
const { useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const qrcode = require('qrcode');

const { PORT: CONFIG_PORT, SOCKET_TOKEN } = require('./config');

// Initialisation de Firebase Admin
// Assurez-vous que les variables d'environnement sont correctement configurées
try {
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  logger.info('[Firebase] Admin SDK initialisé.');
} catch (e) {
  logger.error('[Firebase] Erreur d\'initialisation du Admin SDK:', e);
}

const db = getFirestore();

const app = express();
app.use(cors());
app.use(express.json());

// Simple route
app.get('/', (req, res) => {
  res.json({ ok: true, bot: process.env.BOT_NAME || 'TDA-MD' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Socket.IO middleware: token-based auth (optionnel)
io.use((socket, next) => {
  try {
    const token = (socket.handshake.auth && socket.handshake.auth.token) || socket.handshake.query.token;
    if (SOCKET_TOKEN && token !== SOCKET_TOKEN) {
      const err = new Error('not authorized');
      err.data = { message: 'Invalid socket token' };
      return next(err);
    }
    return next();
  } catch (e) {
    return next(e);
  }
});

const startWaBot = async (phoneNumber, userId, botId) => {
  const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${botId}`);
  const { version, is</*... (Rest of the original code, now with new Baileys logic integrated below) ...*/

const startWaBot = async (phoneNumber, userId, botId) => {
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${botId}`);
    const { version, is) = await fetchLatestBaileysVersion();
    const sock = WAConnection({
        version,
        printQRInTerminal: true,
        auth: state,
        browser: Browsers.macOS('Desktop'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update;
        if (qr) {
            logger.info(`[Socket] QR code généré pour le client ${userId}.`);
            io.to(userId).emit('qrcode', { dataURL: await qrcode.toDataURL(qr) });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                logger.info('[Baileys] Reconnaissance requise. Tentative de reconnexion...');
                await startWaBot(phoneNumber, userId, botId);
            } else {
                logger.info('[Baileys] Déconnexion réussie.');
                // Nettoyer la session dans Firestore et le disque
                const docRef = db.collection(`artifacts/${process.env.FIREBASE_PROJECT_ID}/users`).doc(userId).collection('bots').doc(botId);
                await docRef.delete();
                logger.info(`[Firestore] Bot session ${botId} deleted for user ${userId}.`);
            }
        } else if (connection === 'open') {
            logger.info(`[Baileys] Connexion établie pour le bot ID ${botId}.`);
            const docRef = db.collection(`artifacts/${process.env.FIREBASE_PROJECT_ID}/users`).doc(userId).collection('bots').doc(botId);
            await docRef.set({
                phoneNumber,
                status: 'connected',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            io.to(userId).emit('bot-status', { id: botId, status: 'connected' });
        }
    });

    // Événement pour les messages entrants
    sock.ev.on('messages.upsert', async (m) => {
        // Logique de gestion des messages du bot
    });

    return sock;
};

// Listeners Socket.IO
io.on('connection', (socket) => {
  logger.info(`[socket] Client connecté: ${socket.id}`);
  socket.on('disconnect', (reason) => {
    logger.info(`[socket] Client déconnecté: ${socket.id} (${reason})`);
  });

  socket.on('request-qrcode', async (data) => {
    const { phoneNumber, userId } = data;
    if (!phoneNumber || !userId) {
      socket.emit('error', { message: 'Numéro de téléphone et ID utilisateur requis.' });
      return;
    }
    const botId = uuidv4();
    socket.join(userId);
    try {
        await startWaBot(phoneNumber, userId, botId);
    } catch (e) {
        logger.error(`[Baileys] Erreur lors du démarrage du bot :`, e);
        socket.emit('error', { message: 'Impossible de démarrer le bot WhatsApp.' });
    }
  });

  // autres events personnalisés...
});

// Express error handler
app.use((err, req, res, next) => {
  logger.error(err && err.stack ? err.stack : err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = CONFIG_PORT || process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});

