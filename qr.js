const { makeid } = require('./gen-id');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

const SESSION_DIR = './session'; // Définit le chemin pour les fichiers de session

// Supprime le dossier de session s'il existe
function removeSession() {
    if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
}

// Route principale pour le code QR
router.get('/', async (req, res) => {
    // Si une session existe déjà, on ne génère pas de nouveau QR code
    if (fs.existsSync(SESSION_DIR)) {
        return res.json({ status: "connected", message: "Bot already connected. Please reload the page if you want to reconnect." });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    try {
        let sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }).child({ level: "silent" }),
            browser: Browsers.macOS("Desktop"),
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on("connection.update", async (s) => {
            const { connection, lastDisconnect, qr } = s;

            // Envoie le QR code au navigateur
            if (qr && !res.headersSent) {
                const qrBase64 = await QRCode.toDataURL(qr);
                res.json({ qrCode: qrBase64 });
            }

            if (connection === "open") {
                await delay(5000); // Laisse le temps pour la sauvegarde des crédits
                await sock.ws.close();
                console.log("✅ Connexion QR Code réussie. Le bot va maintenant se lancer.");
                process.exit(); // Arrête le processus pour déclencher le redémarrage par server.js

            } else if (connection === "close") {
                if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    // Ignore les erreurs de déconnexion non liées à l'authentification
                } else {
                    console.log("Session expirée. Veuillez recharger la page pour un nouveau QR code.");
                    removeSession(); // Supprime la session pour forcer une nouvelle connexion
                }
                await delay(10);
                process.exit();
            }
        });
    } catch (err) {
        console.log("Erreur lors de la génération du QR code:", err);
        removeSession();
        if (!res.headersSent) {
            await res.status(500).json({ code: "❗ Service Indisponible" });
        }
    }
});

module.exports = router;

