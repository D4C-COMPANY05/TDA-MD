// server.js - Express + Socket.IO minimal avec auth token optionnel
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const qrcode = require('qrcode');

const { PORT: CONFIG_PORT, SOCKET_TOKEN } = require('./config');

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
  // allowEIO3: true // si besoin pour vieux clients
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

io.on('connection', (socket) => {
  logger.info(`[socket] Client connecté: ${socket.id}`);
  socket.on('disconnect', (reason) => {
    logger.info(`[socket] Client déconnecté: ${socket.id} (${reason})`);
  });

  socket.on('qrcode', async (data) => {
    // exemple : le client demande un qrcode généré côté serveur
    try {
      const qrData = data && data.text ? data.text : 'hello';
      const uri = await qrcode.toDataURL(qrData);
      socket.emit('qrcode', { dataURL: uri });
    } catch (e) {
      socket.emit('error', { message: 'Erreur génération qrcode' });
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
  logger.info(`[server] Écoute sur le port ${PORT}`);
});

// NOTE: Integration Baileys (WhatsApp) n'est pas modifiée ici.
// Si tu veux, je peux intégrer le socket Baileys complet dans ce fichier
// (connexion, QR management, save state, etc.).