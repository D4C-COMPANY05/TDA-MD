// index.js

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const logger = pino({ level: 'silent' });

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
    logger.info('Chargement des commandes...');
    const commandsDir = path.join(__dirname, 'commandes');

    if (!fs.existsSync(commandsDir)) {
        logger.error(`Le dossier 'commandes' n'existe pas à l'adresse: ${commandsDir}`);
        return;
    }

    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        try {
            const command = require(path.join(commandsDir, file));
            if (command.nomCom && command.fonction) {
                commands.set(command.nomCom, command);
                logger.info(`Commande chargée: ${command.nomCom}`);
            } else {
                logger.warn(`Le fichier ${file} n'exporte pas une commande valide.`);
            }
        } catch (error) {
            logger.error(`Erreur lors du chargement de la commande ${file}:`, error);
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

            const text = msg.message?.extendedTextMessage?.text || msg.message?.conversation || '';
            const from = msg.key.remoteJid;
            const prefix = s.PREFIXE;

            if (text.startsWith(prefix)) {
                const commandName = text.slice(prefix.length).split(' ')[0].toLowerCase();
                const command = commands.get(commandName);

                if (command) {
                    try {
                        const commandeOptions = {
                            ms: msg,
                            repondre: (msgText) => sock.sendMessage(from, { text: msgText }, { quoted: msg }),
                            prefixe: s.PREFIXE,
                            nomAuteurMessage: msg.pushName || 'Inconnu',
                            mybotpic: () => "https://placehold.co/600x400/000000/FFFFFF?text=Menu", // Simulation d'une fonction
                        };
                        
                        logger.info(`[Bot] Exécution de la commande '${commandName}' depuis ${from}`);
                        await command.fonction(from, sock, commandeOptions);
                    } catch (error) {
                        logger.error(`Erreur lors de l'exécution de la commande '${commandName}':`, error);
                        await sock.sendMessage(from, { text: 'Une erreur s\'est produite lors de l\'exécution de cette commande.' });
                    }
                }
            }
        }
    });
};

module.exports = { handleBotMessages };

