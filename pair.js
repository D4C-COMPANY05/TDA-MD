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
    const id = makeid();
    let num = req.query.number;

    async function TDA_XMD_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);

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

            // Demande le pairing code si le compte n'est pas encore enregistré
            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection == "open") {
                    console.log("✅ Connection is open. Attempting to save session...");
                    let rf = __dirname + `/temp/${id}/creds.json`;

                    if (fs.existsSync(rf)) {
                        console.log("Found creds file. Starting upload to Mega.");
                        try {
                            // Upload session sur Mega
                            const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
                            
                            // Log de l'URL pour le débogage
                            console.log("Mega URL:", mega_url);

                            if (!mega_url) {
                                throw new Error("Mega URL is undefined.");
                            }

                            const string_session = mega_url.replace('https://mega.nz/file/', '');
                            let md = "TDA~XMD~" + string_session;

                            // Envoi de la session et du message à l'utilisateur
                            let codeMsg = await sock.sendMessage(sock.user.id, { text: md });

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
                                        thumbnailUrl: "https://files.catbox.moe/phamfv.jpg", // remplace si tu veux ton image
                                        sourceUrl: "https://whatsapp.com/channel/EXEMPLE_CHANNEL_TDA",
                                        mediaType: 1,
                                        renderLargerThumbnail: true
                                    }
                                }
                            }, { quoted: codeMsg });
                            
                            // Ajout d'un délai pour s'assurer que le message est bien envoyé
                            await delay(5000); 

                        } catch (e) {
                            console.error("❌ Error during pairing:", e);
                            await sock.sendMessage(sock.user.id, { text: "❌ Error during pairing: " + e.message });
                        }
                    } else {
                        console.log("Creds file not found. Skipping upload.");
                    }

                    // Nettoyage
                    await delay(100);
                    await sock.ws.close();
                    await removeFile('./temp/' + id);
                    console.log(`👤 ${sock.user.id} connected ✅ Restarting...`);
                    await delay(100);
                    process.exit();

                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(100);
                    TDA_XMD_PAIR_CODE();
                }
            });
        } catch (err) {
            console.error("Service restarted");
            await removeFile('./temp/' + id);
            if (!res.headersSent) {
                await res.send({ code: "❗ Service Unavailable" });
            }
        }
    }

    return await TDA_XMD_PAIR_CODE();
});

module.exports = router;

