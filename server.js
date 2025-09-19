// server.js

process.on('unhandledRejection', console.dir);

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const pino = require('pino');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.static('public'));

const activeSessions = new Map();
const RECONNECT_DELAY = 5000; // ms
const MAX_RECONNECT_ATTEMPTS = 5;

// --- Connexion via WhatsApp ---
const connectToWhatsApp = async (socket, sessionId, attempt = 1) => {
  try {
    socket.emit('connecting', { sessionId });
    const { state, saveCreds } = await useMultiFileAuthState('baileys-session-' + sessionId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'info' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      auth: state,
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;

      if (qr) {
        const qrCodeBase64 = await qrcode.toDataURL(qr);
        console.log(`[Baileys] QR généré pour ${sessionId}`);
        socket.emit('qrCode', qrCodeBase64);
      }

      if (isNewLogin) {
        console.log(`[Baileys] Nouveau login pour ${sessionId}`);
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        console.log(`[Baileys] Connexion fermée pour ${sessionId}, raison:`, reason);
        socket.emit('disconnected', reason);

        if (reason !== DisconnectReason.loggedOut && attempt <= MAX_RECONNECT_ATTEMPTS) {
          console.log(`[Baileys] Tentative de reconnexion (${attempt}) pour ${sessionId} dans ${RECONNECT_DELAY}ms`);
          setTimeout(() => connectToWhatsApp(socket, sessionId, attempt + 1), RECONNECT_DELAY);
        } else {
          console.log(`[Baileys] Connexion finale fermée pour ${sessionId}`);
          activeSessions.delete(sessionId);
        }
      } else if (connection === 'open') {
        console.log(`[Baileys] Connexion ouverte pour ${sessionId}`);
        socket.emit('connected', 'Connexion réussie !');
      }
    });

    sock.ev.on('creds.update', saveCreds);

    activeSessions.set(sessionId, sock);
  } catch (err) {
    console.error(`[Baileys] Erreur connexion WhatsApp pour ${sessionId}:`, err);
    socket.emit('error', 'Erreur lors de la connexion à WhatsApp');
  }
};

// --- Socket.IO ---
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connecté: ${socket.id}`);

  socket.on('startQR', (data) => {
    if (!data.sessionId) return socket.emit('error', 'sessionId manquant');
    console.log(`[Socket.IO] startQR pour session: ${data.sessionId}`);
    connectToWhatsApp(socket, data.sessionId);
  });

  socket.on('startPairingCode', async (data) => {
    try {
      if (!data.sessionId || !data.phoneNumber) return socket.emit('error', 'sessionId ou phoneNumber manquant');

      console.log(`[Socket.IO] startPairingCode pour session: ${data.sessionId}, numéro: ${data.phoneNumber}`);
      const { state, saveCreds } = await useMultiFileAuthState('baileys-session-' + data.sessionId);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        logger: pino({ level: 'info' }),
        browser: Browsers.macOS('Desktop'),
        auth: state,
        shouldIgnoreConditionalConn: true,
      });

      sock.ev.on('creds.update', saveCreds);

      const pairingData = await sock.requestPairingCode(data.phoneNumber);
      console.log(`[Baileys] Pairing code généré pour ${data.sessionId}`);
      socket.emit('pairingCode', pairingData);

      sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') {
          console.log(`[Baileys] Connexion ouverte pour ${data.sessionId} via pairing code`);
          socket.emit('connected', 'Connexion réussie via code d\'appariement !');
        } else if (connection === 'close') {
          console.log(`[Baileys] Connexion fermée pour ${data.sessionId} via pairing code`);
          socket.emit('disconnected', 'Connexion fermée');
          activeSessions.delete(data.sessionId);
        }
      });

      activeSessions.set(data.sessionId, sock);
    } catch (err) {
      console.error(`[Baileys] Erreur pairing code pour ${data.sessionId}:`, err);
      socket.emit('error', 'Erreur lors de la génération du code d\'appariement');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client déconnecté: ${socket.id}`);
    // On pourrait supprimer toutes les sessions associées à ce socket si besoin
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});

