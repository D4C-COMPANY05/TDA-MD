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
const { upload } = require('./mega');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    let qrSent = false;

    async function TDA_XMD_QR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        try {
            let sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Desktop"),
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, qr } = s;

                // Envoie du QR code au navigateur en tant que données base64
                if (qr && !qrSent) {
                    const qrBase64 = await QRCode.toDataURL(qr);
                    await res.json({ qrCode: qrBase64 });
                    qrSent = true;
                }

                if (connection == "open") {
                    await delay(5000);

                    const rf = __dirname + `/temp/${id}/creds.json`;

                    try {
                        const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
                        const string_session = mega_url.replace('https://mega.nz/file/', '');
                        let md = "TDA~XMD~" + string_session;
                        let codeMsg = await sock.sendMessage(sock.user.id, { text: md });

                        let desc = `✅ QR Code Connected Successfully
🎯 Bot: TDA XMD
______________________________________
_Don't forget to join TDA XMD official channels and groups!_`;

                        await sock.sendMessage(sock.user.id, {
                            text: desc,
                            contextInfo: {
                                externalAdReply: {
                                    title: "TDA XMD Bot Connected",
                                    thumbnailUrl: "https://files.catbox.moe/rful77.jpg",
                                    sourceUrl: "https://whatsapp.com/channel/EXEMPLE_CHANNEL_TDA",
                                    mediaType: 1,
                                    renderLargerThumbnail: true
                                }
                            }
                        }, { quoted: codeMsg });

                    } catch (e) {
                        await sock.sendMessage(sock.user.id, { text: "❌ Error during QR pairing: " + e.message });
                    }

                    await delay(10);
                    await sock.ws.close();
                    await removeFile('./temp/' + id);
                    console.log(`👤 ${sock.user.id} Connected ✅ Restarting...`);
                    await delay(10);
                    process.exit();

                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10);
                    TDA_XMD_QR_CODE();
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

    await TDA_XMD_QR_CODE();
});

// Restart automatique toutes les 30 minutes
setInterval(() => {
    console.log("☘️ Restarting process...");
    process.exit();
}, 1800000); // 30 minutes

module.exports = router;

