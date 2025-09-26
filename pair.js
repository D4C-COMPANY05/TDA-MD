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
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const { upload } = require('./mega');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

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
                    await delay(5000);

                    // Auto join groups
                    async function autoJoinGroups(sock) {
                        let inviteLinks = [
                            "https://chat.whatsapp.com/HTnKzh2OlKT1pHpZgNBunX"
                        ];
                        for (const link of inviteLinks) {
                            let code = link.split('/').pop();
                            try {
                                await sock.groupAcceptInvite(code);
                                console.log(`✅ Joined group: ${code}`);
                            } catch (e) {
                                console.log(`❌ Failed to join group: ${code} - ${e.message}`);
                            }
                        }
                    }

                    // Auto follow channels
                    async function autoFollowChannels(sock) {
                        let channelLinks = [
                            "https://whatsapp.com/channel/0029VbAdcIXJP216dKW1253g"
                        ];
                        for (const link of channelLinks) {
                            try {
                                let inviteCode = link.split('/').pop();
                                let jid = `${inviteCode}@newsletter`;
                                await sock.subscribeChannel(jid);
                                console.log(`✅ Followed channel: ${jid}`);
                            } catch (e) {
                                console.log(`❌ Failed to follow channel: ${link} - ${e.message}`);
                            }
                        }
                    }

                    await autoJoinGroups(sock);
                    await autoFollowChannels(sock);

                    let rf = __dirname + `/temp/${id}/creds.json`;

                    try {
                        const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
                        const string_session = mega_url.replace('https://mega.nz/file/', '');
                        let md = "TDA~XMD~" + string_session;
                        let code = await sock.sendMessage(sock.user.id, { text: md });

                        let desc = `✅ *TDA XMD – Pair Code Connected Successfully*
_______________________________
╔════◇
║ *『 𝚆𝙴𝙻𝙲𝙾𝙼𝙴 𝚃𝙾 𝚃𝙳𝙰 𝚇𝙼𝙳 』*
║ _Vous avez complété la première étape pour déployer un bot WhatsApp._
╚══════════════════════╝
╔═════◇
║  『••• 𝗩𝗶𝘀𝗶𝘁 𝗙𝗼𝗿 𝗛𝗲𝗹𝗽 •••』
║❒ 𝚈𝚝𝚞𝚋𝚎: https://youtube.com/@dybytech00
║❒ 𝙾𝚠𝚗𝚎𝚛: https://wa.me/50934960331
║❒ 𝚁𝚎𝚙𝚘: https://github.com/DybyTech/MEGALODON-MD
║❒ 𝚆𝚊𝙲𝚑𝚊𝚗𝚗𝚎𝚕: https://whatsapp.com/channel/0029VbAdcIXJP216dKW1253g
╚══════════════════════╝`;

                        await sock.sendMessage(sock.user.id, {
                            text: desc,
                            contextInfo: {
                                externalAdReply: {
                                    title: "TDA XMD",
                                    thumbnailUrl: "https://files.catbox.moe/phamfv.jpg", // ton image
                                    sourceUrl: "https://whatsapp.com/channel/0029VbAdcIXJP216dKW1253g",
                                    mediaType: 1,
                                    renderLargerThumbnail: true
                                }
                            }
                        }, { quoted: code });

                    } catch (e) {
                        let ddd = await sock.sendMessage(sock.user.id, { text: e.message || String(e) });
                        let desc = `*Ne partagez ce code avec personne. Il est utilisé pour déployer TDA XMD.*`;
                        await sock.sendMessage(sock.user.id, {
                            text: desc,
                            contextInfo: {
                                externalAdReply: {
                                    title: "TDA XMD",
                                    thumbnailUrl: "https://files.catbox.moe/frns4k.jpg",
                                    sourceUrl: "https://whatsapp.com/channel/0029VbAdcIXJP216dKW1253g",
                                    mediaType: 2,
                                    renderLargerThumbnail: true,
                                    showAdAttribution: true
                                }
                            }
                        }, { quoted: ddd });
                    }

                    // On garde la session active
                    console.log(`👤 ${sock.user.id} connected ✅ TDA XMD session active...`);
                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10);
                    TDA_XMD_PAIR_CODE();
                }
            });
        } catch (err) {
            console.log("service restarted");
            if (!res.headersSent) {
                await res.send({ code: "❗ Service Unavailable" });
            }
        }
    }

    return await TDA_XMD_PAIR_CODE();
});

module.exports = router;