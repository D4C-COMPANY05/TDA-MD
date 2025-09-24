const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');

const SESSION_DIR = './session';

async function startBot() {
    // Vérifier si la session existe
    if (!fs.existsSync(SESSION_DIR)) {
        console.log("❌ Le bot n'a pas de session. Veuillez d'abord vous connecter via un QR code ou un code d'appariement.");
        return; // Arrêter le processus
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        printQRInTerminal: true,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: Browsers.macOS("Desktop"),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
            console.log("✅ Bot est connecté et prêt à l'emploi.");
            
            // Auto rejoindre des groupes et canaux (Optionnel)
            async function autoJoinAndFollow(sock) {
                let inviteLinks = [
                    "https://chat.whatsapp.com/EXEMPLE_GROUP_TDA" 
                ];
                for (const link of inviteLinks) {
                    try {
                        let code = link.split('/').pop();
                        await sock.groupAcceptInvite(code);
                        console.log(`✅ Rejoint le groupe: ${code}`);
                    } catch (e) {
                        console.log(`❌ Échec de rejoindre le groupe: ${link} - ${e.message}`);
                    }
                }

                let channelLinks = [
                    "https://whatsapp.com/channel/EXEMPLE_CHANNEL_TDA" 
                ];
                for (const link of channelLinks) {
                    try {
                        let inviteCode = link.split('/').pop();
                        let jid = `${inviteCode}@newsletter`;
                        await sock.subscribeChannel(jid);
                        console.log(`✅ A suivi le canal: ${jid}`);
                    } catch (e) {
                        console.log(`❌ Échec de suivre le canal: ${link} - ${e.message}`);
                    }
                }
            }

            await autoJoinAndFollow(sock);

            try {
                const welcomeMessage = "✅ Bot est connecté et prêt à l'emploi ! \n\nUtilisez des commandes comme `!help` pour commencer.";
                await sock.sendMessage(sock.user.id, { text: welcomeMessage });
            } catch (e) {
                console.error("❌ Erreur lors de l'envoi du message de bienvenue :", e);
            }
        } else if (connection === "close") {
            console.log("❌ Connexion fermée. Dernière déconnexion:", lastDisconnect);
            // Si la déconnexion est due à une erreur d'authentification, on supprime la session
            if (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode === 401) {
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                console.log("Session invalide. Veuillez recharger la page pour vous reconnecter.");
                process.exit(1); // Arrêter le processus pour qu'il soit relancé sans session
            }
            // Sinon, on essaie de reconnecter
            startBot();
        }
    });

    // Écoute des messages entrants pour les commandes
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message.key.fromMe && !message.message.reactionMessage) {
            const text = message.message?.extendedTextMessage?.text || message.message?.conversation;

            if (text) {
                const command = text.trim().toLowerCase();
                const senderId = message.key.remoteJid;

                if (command === '!help') {
                    await sock.sendMessage(senderId, { text: "Commandes disponibles: \n`!ping` \n`!echo <votre message>` \n`!id`" });
                } else if (command === '!ping') {
                    await sock.sendMessage(senderId, { text: "Pong!" });
                } else if (command.startsWith('!echo')) {
                    const echoText = text.substring('!echo'.length).trim();
                    await sock.sendMessage(senderId, { text: echoText });
                } else if (command === '!id') {
                    await sock.sendMessage(senderId, { text: `Votre ID: ${senderId}` });
                }
            }
        }
    });
}

// Le script commence ici
startBot();

