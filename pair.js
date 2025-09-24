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
                    await delay(5000); // Augmenter ce délai pour permettre l'écriture des fichiers.

                    let rf = __dirname + `/temp/${id}/creds.json`;

                    try {
                        if (fs.existsSync(rf)) {
                            console.log("Found creds file. Starting upload to Mega.");
                            // Upload session sur Mega
                            const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
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

                        } else {
                            console.log("❌ creds file not found. Session not saved.");
                        }
                    } catch (e) {
                        console.log("❌ Error during pairing:", e);
                        await sock.sendMessage(sock.user.id, { text: "❌ Error during pairing: " + e.message });
                    }

                    // Nettoyage
                    await delay(10000); // Délai de 10 secondes avant de fermer
                    await sock.ws.close();
                    await removeFile('./temp/' + id);
                    console.log(`👤 ${sock.user.id} connected ✅ Restarting...`);
                    await delay(10);
                    process.exit();

                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10);
                    TDA_XMD_PAIR_CODE();
                }
            });
        } catch (err) {
            console.log("Service restarted");
            await removeFile('./temp/' + id);
            if (!res.headersSent) {
                await res.send({ code: "❗ Service Unavailable" });
            }
        }
    }

    return await TDA_XMD_PAIR_CODE();
});

module.exports = router;

