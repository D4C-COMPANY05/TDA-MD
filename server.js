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
// Assurez-vous que la clé privée est correctement formatée pour être utilisée dans un environnement
// de production (les sauts de ligne doivent être gérés).
const serviceAccount = {
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
};

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialisé avec succès.');
} catch (error) {
    console.error('Erreur lors de l\'initialisation de Firebase Admin SDK:', error.message);
}

const db = admin.firestore();

const sessions = new Map();

// Fonction pour démarrer une session Baileys
async function startSession(phoneNumber, userId, socket) {
    // Si une session existe déjà pour ce numéro, on la termine pour éviter les doublons.
    if (sessions.has(phoneNumber)) {
        sessions.get(phoneNumber).sock.ev.removeAllListeners();
        sessions.delete(phoneNumber);
    }

    const sessionDir = `./sessions/${phoneNumber}`;
    
    // Vérifie si le dossier de session existe déjà
    if (fs.existsSync(sessionDir)) {
        logger.info(`[Session] Reconnexion de la session pour le numéro: ${phoneNumber}`);
    } else {
        // Sinon, crée le dossier pour stocker les informations
        fs.mkdirSync(sessionDir, { recursive: true });
        logger.info(`[Session] Nouveau dossier de session créé pour le numéro: ${phoneNumber}`);
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
                logger.info(`[QR] QR Code généré pour le numéro: ${phoneNumber}`);
            } catch (e) {
                logger.error(`[QR] Erreur lors de la génération du QR Code: ${e}`);
                socket.emit('error', { message: 'Erreur lors de la génération du QR code.' });
            }
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
            // Gère les déconnexions pour lesquelles une reconnexion n'est pas nécessaire.
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                logger.error(`[Bot] Déconnecté, reconnexion...`);
                startSession(phoneNumber, userId, socket);
            } else {
                logger.warn(`[Bot] Session pour ${phoneNumber} terminée. Raison: ${lastDisconnect.error}`);
                socket.emit('error', { message: 'Session expirée. Veuillez scanner un nouveau QR code.' });
                sessions.delete(phoneNumber);
                // Supprime le dossier de session local
                try {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    logger.info(`[Session] Dossier de session supprimé pour ${phoneNumber}.`);
                } catch (e) {
                    logger.error(`[Session] Erreur lors de la suppression du dossier de session: ${e}`);
                }
            }
            // Met à jour le statut dans Firestore
            await db.collection('bots').doc(phoneNumber).update({
                status: 'déconnecté',
                lastSeen: admin.firestore.FieldValue.serverTimestamp()
            }).catch(e => logger.error(`[Firestore] Erreur de mise à jour du statut dans Firestore: ${e}`));
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
    
    socket.on('request-qrcode', (data) => {
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

