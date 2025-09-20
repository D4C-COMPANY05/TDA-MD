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
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const logger = pino({ level: 'info' });

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.send('Serveur TDA-MD en cours d\'exécution.');
});

// Initialisation de Firebase Admin
const serviceAccount = {
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const sessions = new Map();

// Fonction pour démarrer une session
async function startSession(phoneNumber, userId, socket) {
    if (sessions.has(phoneNumber)) {
        sessions.get(phoneNumber).sock.ev.removeAllListeners();
        sessions.delete(phoneNumber);
    }

    const sessionDir = `./sessions/${phoneNumber}`;
    let shouldLoadFromDb = false;
    
    // Vérifie si un dossier de session existe déjà
    if (fs.existsSync(sessionDir)) {
        shouldLoadFromDb = true;
    } else {
        // Sinon, crée le dossier pour stocker les informations
        fs.mkdirSync(sessionDir, { recursive: true });
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
            const qrCodeDataURL = await qrcode.toDataURL(qr);
            socket.emit('qrcode', { qrCodeDataURL });
            logger.info(`[QR] QR Code généré pour le numéro: ${phoneNumber}`);
        }

        if (connection === 'open') {
            await db.collection('bots').doc(phoneNumber).set({
                userId: userId,
                phoneNumber: phoneNumber,
                status: 'connecté',
                lastSeen: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            const welcomeMessage = `*🤖 Bot TDA-MD connecté !*\n\nBienvenue ! Je suis maintenant en ligne et prêt à recevoir des commandes.`;
            await sock.sendMessage(phoneNumber + '@s.whatsapp.net', { text: welcomeMessage });

            logger.info(`[Bot] Bot connecté pour le numéro: ${phoneNumber}. Session enregistrée dans Firestore.`);
            socket.emit('pairing-success', { message: 'Bot connecté avec succès!' });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                logger.error(`[Bot] Déconnecté, reconnexion...`);
                startSession(phoneNumber, userId, socket);
            } else {
                logger.warn(`[Bot] Session pour ${phoneNumber} terminée. Raison: ${lastDisconnect.error}`);
                socket.emit('error', { message: 'Session expirée. Veuillez scanner un nouveau QR code.' });
                sessions.delete(phoneNumber);
                // Supprime le dossier de session local
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
            await db.collection('bots').doc(phoneNumber).update({
                status: 'déconnecté',
                lastSeen: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Enregistre les messages entrants
    sock.ev.on('messages.upsert', async (m) => {
        if (m.messages[0].key.remoteJid === 'status@broadcast') return;
        const message = m.messages[0];
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        logger.info(`[Message] Message reçu de ${message.key.remoteJid}: ${text}`);
    });
}

io.on('connection', (socket) => {
    logger.info(`[socket] Client connecté: ${socket.id}`);

    socket.on('start-pairing', (data) => {
        const { phoneNumber, userId } = data;
        if (!phoneNumber || !userId) {
            socket.emit('error', { message: 'Numéro de téléphone ou ID utilisateur manquant.' });
            return;
        }
        startSession(phoneNumber, userId, socket).catch(e => {
            logger.error(`[Serveur] Erreur lors du couplage: ${e}`);
            socket.emit('error', { message: 'Erreur interne du serveur lors de la tentative de couplage.' });
        });
    });

    socket.on('disconnect', (reason) => {
        logger.info(`[socket] Client déconnecté: ${socket.id} (${reason})`);
    });
});

server.listen(PORT, () => {
    logger.info(`Serveur en cours d'exécution sur le port ${PORT}`);
});

