// server.js

// Définir la gestion des rejets non gérés pour attraper les erreurs non capturées
process.on('unhandledRejection', console.dir);

// Importation des modules nécessaires
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const pino = require('pino');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

// Importation des fonctions de Baileys
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

// Chargement des variables d'environnement depuis le fichier .env
require('dotenv').config();

// Initialisation de l'application Express et du serveur HTTP
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.static('public'));

// Map pour stocker les sessions actives par ID de session
const activeSessions = new Map();

// Fonction pour démarrer la connexion WhatsApp
const connectToWhatsApp = async (socket, sessionId) => {
    // Utilise le stockage local de Baileys au lieu d'une base de données
    const { state, saveCreds } = await useMultiFileAuthState('baileys-session-' + sessionId);

    const { version } = await fetchLatestBaileysVersion();
    console.log(`[Baileys] Version: ${version}. Initialisation de la session pour l'ID: ${sessionId}.`);
    
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'info' }),
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        auth: state,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications, isOnline } = update;

        if (qr) {
            const qrCodeBase64 = await qrcode.toDataURL(qr);
            console.log(`[Baileys] QR Code généré pour l'ID: ${sessionId}`);
            socket.emit('qrCode', qrCodeBase64);
        }

        if (isNewLogin) {
            console.log(`[Baileys] Nouveau login pour la session : ${sessionId}`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[Baileys] La connexion a été fermée pour l'ID: ${sessionId}, raison:`, lastDisconnect?.error);
            socket.emit('closed', lastDisconnect?.error);

            if (shouldReconnect) {
                console.log(`[Baileys] Reconnaissance automatique pour la session : ${sessionId}`);
                connectToWhatsApp(socket, sessionId);
            }
        } else if (connection === 'open') {
            console.log(`[Baileys] Connexion ouverte pour l'ID: ${sessionId}`);
            socket.emit('connected', 'Connexion réussie !');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    activeSessions.set(sessionId, sock);
};

io.on('connection', (socket) => {
    console.log(`[Socket.IO] Un client est connecté: ${socket.id}`);
    
    // Attendre le signal du client avant de démarrer
    socket.on('startQR', (data) => {
        console.log(`[Socket.IO] Requête 'startQR' reçue pour la session: ${data.sessionId}`);
        connectToWhatsApp(socket, data.sessionId);
    });

    socket.on('startPairingCode', async (data) => {
        console.log(`[Socket.IO] Requête 'startPairingCode' reçue pour la session: ${data.sessionId}, numéro: ${data.phoneNumber}`);
        
        const { state, saveCreds } = await useMultiFileAuthState('baileys-session-' + data.sessionId);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'info' }),
            browser: Browsers.macOS('Desktop'),
            auth: state,
        });

        const pairingCode = await sock.requestPairingCode(data.phoneNumber);
        if (pairingCode) {
            socket.emit('pairingCode', pairingCode);
        }
    
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', (update) => {
            const { connection } = update;
            if (connection === 'open') {
                socket.emit('connected', 'Connexion réussie via code d\'appariement !');
            } else if (connection === 'close') {
                socket.emit('error', 'La connexion a été fermée.');
            }
        });
    });

    socket.on('disconnect', () => {
        // La logique de déconnexion est maintenant gérée par le client
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Le serveur est à l'écoute sur le port ${PORT}`);
});

