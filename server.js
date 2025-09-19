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

// --- Connexion via QR ---
const connectToWhatsApp = async (socket, sessionId) => {
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
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[Baileys] Connexion fermée pour ${sessionId}, raison:`, lastDisconnect?.error);
      socket.emit('closed', lastDisconnect?.error);

      if (shouldReconnect) {
        console.log(`[Baileys] Tentative de reconnexion pour ${sessionId}`);
        connectToWhatsApp(socket, sessionId);
      }
    } else if (connection === 'open') {
      console.log(`[Baileys] Connexion ouverte pour ${sessionId}`);
      socket.emit('connected', 'Connexion réussie !');
    }
  });

  sock.ev.on('creds.update', saveCreds);
  activeSessions.set(sessionId, sock);
};

// --- Socket.IO ---
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connecté: ${socket.id}`);

  // Mode QR
  socket.on('startQR', (data) => {
    console.log(`[Socket.IO] startQR pour session: ${data.sessionId}`);
    connectToWhatsApp(socket, data.sessionId);
  });

  // Mode Pairing Code
  socket.on('startPairingCode', async (data) => {
    try {
      console.log(`[Socket.IO] startPairingCode pour session: ${data.sessionId}, numéro: ${data.phoneNumber}`);

      const { state, saveCreds } = await useMultiFileAuthState('baileys-session-' + data.sessionId);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        logger: pino({ level: 'info' }),
        browser: Browsers.macOS('Desktop'),
        auth: state
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection } = update;

        if (connection === 'open') {
          console.log(`[Baileys] Connexion WebSocket OK → génération du pairing code...`);
          try {
            console.log("[Baileys] Numéro reçu :", data.phoneNumber);
            const code = await sock.requestPairingCode(data.phoneNumber);
            console.log(`[Baileys] Pairing code généré : ${code}`);
            socket.emit('pairingCode', code);
          } catch (err) {
            console.error("[Baileys] Erreur lors de la génération du pairing code :", err);
            socket.emit('error', 'Impossible de générer le code d\'appariement');
          }
        } else if (connection === 'close') {
          console.log(`[Baileys] Connexion fermée pour ${data.sessionId}`);
          socket.emit('error', 'La connexion a été fermée.');
        }
      });

      activeSessions.set(data.sessionId, sock);

    } catch (err) {
      console.error("[Baileys] Erreur pairing code (setup):", err);
      socket.emit('error', 'Erreur lors de la configuration du code d\'appariement');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client déconnecté: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});