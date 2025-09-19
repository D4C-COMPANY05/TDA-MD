// index.js

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Collection pour stocker les commandes
const commands = new Map();

// Simulation de la variable globale `s`
const s = {
    BOT: "TDA-MD",
    PREFIXE: ".",
    NOM_OWNER: "Kiyotaka Ayanokoji",
    MODE: "oui"
};

/**
 * Charge toutes les commandes depuis le dossier 'commandes'.
 */
const loadCommands = () => {
    logger.info('🔄 Rechargement des commandes...');
    const commandsDir = path.join(__dirname, 'commandes');

    if (!fs.existsSync(commandsDir)) {
        logger.error(`❌ Le dossier 'commandes' est introuvable: ${commandsDir}`);
        return;
    }

    commands.clear(); // Nettoyer les anciennes commandes
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        try {
            const commandPath = path.join(commandsDir, file);

            // Supprime l'ancienne version du cache pour recharger à chaud
            delete require.cache[require.resolve(commandPath)];
            const command = require(commandPath);

            if (command.nomCom && command.fonction) {
                // Gestion des alias
                if (Array.isArray(command.nomCom)) {
                    command.nomCom.forEach(n => commands.set(n.toLowerCase(), command));
                } else {
                    commands.set(command.nomCom.toLowerCase(), command);
                }
                logger.info(`✅ Commande chargée: ${command.nomCom}`);
            } else {
                logger.warn(`⚠️ Le fichier ${file} n'exporte pas une commande valide.`);
            }
        } catch (error) {
            logger.error(`❌ Erreur lors du chargement de la commande ${file}:`, error);
        }
    }
};

/**
 * Gère la logique du bot, y compris l'envoi de messages et la gestion des commandes.
 * @param {import('@whiskeysockets/baileys').WASocket} sock Le socket Baileys.
 */
const handleBotMessages = (sock) => {
    loadCommands();

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

            const from = msg.key.remoteJid;

            // Récupérer le texte du message (conversation, texte étendu, légende image/vidéo, bouton…)
            const text =
                msg.message?.extendedTextMessage?.text ||
                msg.message?.conversation ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                msg.message?.buttonsResponseMessage?.selectedButtonId ||
                msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                '';

            if (!text) continue;

            // Vérifier si le texte commence par le préfixe
            const prefix = s.PREFIXE;
            if (!text.startsWith(prefix)) continue;

            const args = text.slice(prefix.length).trim().split(/\s+/);
            const commandName = args.shift().toLowerCase();
            const command = commands.get(commandName);

            if (command) {
                try {
                    const commandeOptions = {
                        ms: msg,
                        repondre: (msgText) => sock.sendMessage(from, { text: msgText }, { quoted: msg }),
                        prefixe: s.PREFIXE,
                        nomAuteurMessage: msg.pushName || 'Inconnu',
                        mybotpic: () => "https://placehold.co/600x400/000000/FFFFFF?text=Menu", // Simulation
                        args
                    };

                    logger.info(`[Bot] Exécution de '${commandName}' par ${commandeOptions.nomAuteurMessage} (${from})`);
                    await command.fonction(from, sock, commandeOptions);
                } catch (error) {
                    logger.error(`❌ Erreur lors de l'exécution de '${commandName}':`, error);
                    await sock.sendMessage(from, { text: '⚠️ Une erreur est survenue lors de l’exécution de cette commande.' }, { quoted: msg });
                }
            } else {
                await sock.sendMessage(from, { text: `❌ Commande inconnue. Tape ${prefix}help pour la liste.` }, { quoted: msg });
            }
        }
    });
};

module.exports = { handleBotMessages };