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
        syncFullHistory: false,
        browser: Browsers.macOS(randomItem),
      });

      // hook erreurs WebSocket
      sock.ws?.on('error', (err) => {
        console.error('WebSocket error:', err);
      });

      // Demande le pairing code si le compte n'est pas encore enregistré
      if (!sock.authState.creds.registered) {
        if (!num) {
          return !res.headersSent && res.status(400).json({ error: 'Missing number parameter' });
        }

        await delay(1500);
        num = num.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) {
          res.json({ code, sessionId: id }); // on retourne aussi l'id de session
        }
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
          let rf = `${sessionPath}/creds.json`;

          if (fs.existsSync(rf)) {
            console.log("Found creds file. Starting upload to Mega.");
            try {
              const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);

              const string_session = mega_url.replace('https://mega.nz/file/', '');
              let md = "TDA~XMD~" + string_session;

              let codeMsg = await sock.sendMessage(sock.user.id, { text: md });
              await delay(1000);

              let desc = `✅ Pairing Code Connected Successfully
🎯 Bot: TDA XMD
_______________________________
╔════◇
║ *『 𝗧𝗗𝗔 𝗫𝗠𝗗 𝗣𝗔𝗜𝗥𝗜𝗡𝗚 𝗦𝗨𝗖𝗖𝗘𝗦𝗦 』*
║ _You have completed the first step to deploy your WhatsApp bot._
╚══════════════════════╝`;

              await sock.sendMessage(sock.user.id, {
                text: desc,
                contextInfo: {
                  externalAdReply: {
                    title: "TDA XMD",
                    thumbnailUrl: "https://files.catbox.moe/phamfv.jpg",
                    sourceUrl: "https://whatsapp.com/channel/EXEMPLE_CHANNEL_TDA",
                    mediaType: 1,
                    renderLargerThumbnail: true
                  }
                }
              }, { quoted: codeMsg });

              console.log(`👤 ${sock.user.id} connected ✅ (session persisted in ${sessionPath})`);

            } catch (e) {
              console.error("❌ Error during pairing:", e);
              await sock.sendMessage(sock.user.id, { text: "❌ Error during pairing: " + e.message });
            }
          } else {
            console.log("Creds file not found. Skipping upload.");
          }
        } else if (connection === "close") {
          console.log('❌ connection closed', lastDisconnect?.error || lastDisconnect);

          // Handle "Stream Error" - code 515
          if (lastDisconnect?.error?.output?.statusCode === 515) {
            console.log("⚠️ Session corrompue (code 515). Reset en cours...");
            removeFile(sessionPath);

            if (!res.headersSent) {
              // on informe juste le client HTTP de réessayer
              res.json({ code: "🔄 Session reset, re-pair required", sessionId: id });
            }
            // ❌ on ne relance plus TDA_XMD_PAIR_CODE ici (pas de boucle infinie)
          }
        }
      });
    } catch (err) {
      console.log("Service restarted", err);
      if (!res.headersSent) {
        res.status(503).json({ code: "❗ Service Unavailable" });
      }
    }
  }

  return await TDA_XMD_PAIR_CODE();
});

module.exports = router;