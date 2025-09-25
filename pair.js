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
const { upload } = require('./mega');

// Supprimer un fichier ou dossier
function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// Route principale pour pairing
router.get('/', async (req, res) => {
  const id = makeid();                       // nouvel ID unique
  let num = req.query.number;
  let sessionPath = `./session/${id}`;       // chaque utilisateur a son propre dossier

  async function TDA_XMD_PAIR_CODE() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    try {
      const items = ["Safari"];
      const randomItem = items[Math.floor(Math.random() * items.length)];

      let sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        printQRInTerminal: false,
        generateHighQualityLinkPreview: true,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: Browsers.macOS("Desktop"),
      });

      // Envoyer le code d'appariement au navigateur
      if (!sock.authState.creds.registered) {
        let code = await sock.requestPairingCode(num);
        if (!res.headersSent) {
          res.json({ code: code });
        }
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
          console.log(`👤 ${sock.user.id} connected ✅ (session persisted in ${sessionPath})`);

          // Télécharger les identifiants sur Mega (si le fichier de crédits existe)
          if (fs.existsSync(sessionPath + '/creds.json')) {
            try {
              let codeMsg = await sock.sendMessage(sock.user.id, {
                text: `TDA XMD a été connecté avec succès.`,
                contextInfo: {
                  externalAdReply: {
                    title: 'TDA XMD',
                    body: "Développé par TDA",
                    thumbnailUrl: "https://telegra.ph/file/0259b109556dd2d580190.jpg",
                    sourceUrl: "https://whatsapp.com/channel/EXEMPLE_CHANNEL_TDA",
                    mediaType: 1,
                    renderLargerThumbnail: true
                  }
                }
              }, { quoted: codeMsg });

              console.log(`👤 ${sock.user.id} connected ✅ (session persisted in ${sessionPath})`);

            } catch (e) {
              console.error("❌ Erreur durant l'appariement:", e);
              await sock.sendMessage(sock.user.id, { text: "❌ Erreur durant l'appariement: " + e.message });
            }
          } else {
            console.log("Fichier de crédits non trouvé. Le téléchargement est ignoré.");
          }
        } else if (connection === "close") {
          console.log('❌ connexion fermée', lastDisconnect?.error || lastDisconnect);

          // Gérer l'erreur "Stream Error" - code 515 ou la "Connexion fermée" - code 428
          if (lastDisconnect?.error?.output?.statusCode === 515 || lastDisconnect?.error?.output?.statusCode === 428) {
            console.log("⚠️ Session corrompue. Réinitialisation en cours...");
            removeFile(sessionPath);

            if (!res.headersSent) {
              // On informe juste le client HTTP de réessayer
              res.json({ code: "🔄 Session réinitialisée, l'appariement est de nouveau requis", sessionId: id });
            }
          }
        }
      });
    } catch (err) {
      console.log("Service redémarré", err);
      if (!res.headersSent) {
        res.status(503).json({ code: "❗ Service non disponible" });
      }
    }
  }

  return await TDA_XMD_PAIR_CODE();
});

module.exports = router;

