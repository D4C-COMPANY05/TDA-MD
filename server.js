// Importation des dépendances et des modules
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeInMemoryStore,
    fetchLatestBaileysVersion,
    is
} = require('@adiwajshing/baileys');
const { Firestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const pino = require('pino');
const QRCode = require('qrcode');

// Configuration de Firebase Admin SDK
// L'objet serviceAccount est soit un chemin de fichier local (pour le développement)
// ou le contenu de la clé de service directement depuis les variables d'environnement (pour le déploiement sur Railway)
let serviceAccount;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        // Pour Railway, on utilise le JSON direct
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else {
        // Pour le développement local, on utilise le fichier
        serviceAccount = require('./firebase-service-account.json');
    }
} catch (error) {
    console.error("Erreur lors du chargement de la clé de service Firebase. Vérifiez votre .env ou votre configuration Railway.");
    process.exit(1); // Arrête le processus en cas d'erreur critique
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = new Firestore();
const app = express();
const port = process.env.PORT || 3000;

// Middleware pour gérer les requêtes JSON et le CORS
app.use(express.json());
app.use(cors({
    origin: '*', // Vous pouvez restreindre cela à l'URL de votre front-end pour une meilleure sécurité
    methods: ['POST'],
    allowedHeaders: ['Content-Type']
}));

// --- Fonctions utilitaires pour Baileys ---

/**
 * Sauvegarde les informations d'authentification Baileys dans Firestore.
 * @param {string} sessionId L'ID unique de la session (userID).
 * @returns {Function} Une fonction de sauvegarde des informations de connexion.
 */
const getAuthFromFirestore = async (sessionId) => {
    const sessionDocRef = db.collection('artifacts').doc('tda').collection('sessions').doc(sessionId);
    let creds = {};

    // Chargement initial des informations d'identification depuis Firestore
    const doc = await sessionDocRef.get();
    if (doc.exists) {
        creds = doc.data();
    }

    const saveCreds = (newCreds) => {
        // La fonction `saveCreds` de Baileys ne fournit que les changements.
        // On fusionne les changements avec l'objet creds existant.
        Object.assign(creds, newCreds);
        sessionDocRef.set(creds); // Sauvegarde des informations mises à jour dans Firestore
    };

    return { state: { creds, saveCreds }, store: makeInMemoryStore({ logger: pino().child({ level: 'silent' }) }) };
};

// Endpoint API pour initier la connexion WhatsApp
app.post('/pair', async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'ID de session requis.' });
    }

    console.log(`Tentative de connexion pour l'ID de session ${sessionId}`);

    try {
        const { state } = await getAuthFromFirestore(sessionId);

        // Récupération de la dernière version de Baileys
        const { version } = await fetchLatestBaileysVersion();
        console.log(`Utilisation de Baileys version ${version.join('.')}`);

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }), // Supprime les logs Baileys pour plus de clarté
            printQRInTerminal: false,
            auth: state.creds,
            browser: ['TDA - The Dread Alliance', 'Chrome', '1.0']
        });

        // Liaison de l'état de l'authentification
        sock.ev.on('creds.update', state.saveCreds);
        
        // Gère les événements de connexion
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                // Un QR code a été généré
                QRCode.toDataURL(qr, (err, url) => {
                    if (err) {
                        console.error('Erreur de génération du QR code:', err);
                        return res.status(500).json({ error: 'Erreur de génération du QR code.' });
                    }
                    console.log('QR code généré, envoi au client.');
                    return res.status(200).json({ status: 'qr_code', qrCode: url });
                });
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== 401;
                console.log('Connexion fermée. Reconnexion requise:', shouldReconnect);
                if (shouldReconnect) {
                    // Ici, vous pouvez implémenter la logique de reconnexion
                }
            } else if (connection === 'open') {
                console.log('Connexion ouverte pour l\'ID de session:', sessionId);
                // La session est prête
                return res.status(200).json({ status: 'connected', message: 'Bot connecté avec succès!' });
            }
        });

    } catch (e) {
        console.error("Erreur du serveur Baileys:", e);
        res.status(500).json({ error: 'Une erreur est survenue lors de l\'initialisation de la session.' });
    }
});

// Lancement du serveur
app.listen(port, () => {
    console.log(`Serveur d'appariement TDA démarré sur le port ${port}`);
});
