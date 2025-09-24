const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const SESSION_DIR = './session'; // Définit le chemin pour les fichiers de session

// Supprime le dossier de session s'il existe
function removeSession() {
    if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
}

// Route principale pour le code d'appariement
router.get('/', async (req, res) => {
    // Si une session existe déjà, on ne génère pas de nouveau code
    if (fs.existsSync(SESSION_DIR)) {
        return res.json({ status: "connected", message: "Bot already connected. Please reload the page if you want to reconnect." });
    }
    
    let num = req.query.number;
    if (!num) {
        return res.status(400).json({ error: "Phone number is required." });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    try {
        let sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.macOS("Desktop"),
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            num = num.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(num);
            if (!res.headersSent) {
                await res.json({ code });
            }
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on("connection.update", async (s) => {
            const { connection, lastDisconnect } = s;

            if (connection === "open") {
                await delay(5000); // Laisse le temps pour la sauvegarde des crédits
                await sock.ws.close();
                console.log("✅ Connexion par code d'appariement réussie. Le bot va maintenant se lancer.");
                process.exit(); // Arrête le processus pour que server.js puisse relancer bot.js

            } else if (connection === "close") {
                if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    // Ignore les erreurs de déconnexion non liées à l'authentification
                } else {
                    console.log("Session expirée. Veuillez recharger la page pour un nouveau code.");
                    removeSession();
                }
                await delay(10);
                process.exit();
            }
        });
    } catch (err) {
        console.log("Erreur lors de la génération du code d'appariement:", err);
        removeSession();
        if (!res.headersSent) {
            await res.status(500).json({ code: "❗ Service Indisponible" });
        }
    }
});

module.exports = router;

