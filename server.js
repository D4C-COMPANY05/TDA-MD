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
const { getFirestore, doc, getDoc, setDoc } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

// Importation des fonctions de Baileys
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
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

// Initialisation de Firebase Admin SDK
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } catch (error) {
    console.error("Erreur Firebase: impossible d'initialiser le SDK.", error);
    process.exit(1);
  }
}

const db = getFirestore();

// Map pour stocker les sessions actives par ID de session
const activeSessions = new Map();

// Fonction pour récupérer l'état d'authentification et les fonctions de sauvegarde
const getAuthFromFirestore = async (sessionId) => {
    const sessionDocRef = doc(db, 'artifacts', 'tda', 'users', sessionId, 'sessions', sessionId);
    let creds;

    try {
        const docSnap = await getDoc(sessionDocRef);
        if (docSnap.exists) {
            creds = docSnap.data();
            console.log(`[Firestore] Session trouvée pour l'ID : ${sessionId}`);
        } else {
            console.log(`[Firestore] Nouvelle session. Initialisation des identifiants.`);
            creds = {}; // Baileys initialisera la structure si vide
        }
    } catch (error) {
        console.error(`[Firestore] Erreur lors de la récupération du document de session: ${error}`);
        creds = {}; // En cas d'erreur, on initialise un objet vide pour permettre la connexion
    }

    // Fonction pour sauvegarder les mises à jour des credentials
    const saveCreds = async (newCreds) => {
        Object.assign(creds, newCreds);
        try {
            await setDoc(sessionDocRef, creds);
            console.log(`[Firestore] Données de connexion mises à jour pour la session : ${sessionId}`);
        } catch (error) {
            console.error(`[Firestore] Erreur lors de la sauvegarde des données de session:`, error);
        }
    };
    
    return {
        state: { creds, saveCreds },
        exists: creds && Object.keys(creds).length > 0
    };
};

const connectToWhatsApp = async (socket, sessionId) => {
    const { state, exists } = await getAuthFromFirestore(sessionId);
    
    let sock;
    if (exists) {
        console.log(`[Baileys] Session existante restaurée pour l'ID: ${sessionId}.`);
        const { version } = await fetchLatestBaileysVersion();
        sock = makeWASocket({
            version,
            logger: pino({ level: 'info' }),
            printQRInTerminal: false,
            browser: Browsers.macOS('Desktop'),
            auth: state,
        });
    } else {
        const { version } = await fetchLatestBaileysVersion();
        console.log(`[Baileys] Version: ${version}. Initialisation de la session pour l'ID: ${sessionId}.`);
        sock = makeWASocket({
            version,
            logger: pino({ level: 'info' }),
            printQRInTerminal: false,
            browser: Browsers.macOS('Desktop'),
            auth: state,
        });
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            const qrCodeBase64 = await qrcode.toDataURL(qr);
            console.log(`[Baileys] QR Code généré pour l'ID: ${sessionId}`);
            socket.emit('qr', qrCodeBase64);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[Baileys] La connexion a été fermée pour l'ID: ${sessionId}, raison:`, lastDisconnect?.error);
            socket.emit('closed', lastDisconnect?.error);

            if (shouldReconnect) {
                connectToWhatsApp(socket, sessionId);
            }
        } else if (connection === 'open') {
            console.log(`[Baileys] Connexion ouverte pour l'ID: ${sessionId}`);
            socket.emit('connected');
        }
    });

    sock.ev.on('creds.update', state.saveCreds);

    activeSessions.set(sessionId, sock);
};

io.on('connection', (socket) => {
    console.log(`[Socket.IO] Un client est connecté: ${socket.id}`);
    
    const sessionId = uuidv4();
    socket.join(sessionId);
    console.log(`[Socket.IO] Le client ${socket.id} a rejoint la session ${sessionId}.`);

    connectToWhatsApp(socket, sessionId);

    socket.on('disconnect', () => {
        const sock = activeSessions.get(sessionId);
        if (sock) {
            console.log(`[Socket.IO] Déconnexion du client. Fermeture de la session Baileys pour l'ID: ${sessionId}.`);
            sock.end();
            activeSessions.delete(sessionId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Le serveur est à l'écoute sur le port ${PORT}`);
});

