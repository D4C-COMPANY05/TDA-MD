// index.js

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const logger = pino({ level: 'silent' });

// Collection pour stocker les commandes
const commands = new Map();

/**
 * Charge toutes les commandes depuis le dossier 'commandes'.
 */
const loadCommands = () => {
    logger.info('Chargement des commandes...');
    const commandsDir = path.join(__dirname, 'commandes');

    // Vérifier si le dossier des commandes existe
    if (!fs.existsSync(commandsDir)) {
        logger.error(`Le dossier 'commandes' n'existe pas à l'adresse: ${commandsDir}`);
        return;
    }

    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        try {
            const command = require(path.join(commandsDir, file));
            if (command.name && command.execute) {
                commands.set(command.name, command);
                logger.info(`Commande chargée: ${command.name}`);
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

    // Écoute les messages entrants et répond aux commandes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; // Ignorer les notifications

        for (const msg of messages) {
            // Ignorer si le message est vide, du bot lui-même ou s'il s'agit d'un message d'état
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

            const text = msg.message?.extendedTextMessage?.text || msg.message?.conversation || '';
            const from = msg.key.remoteJid;
            const prefix = '!';

            if (text.startsWith(prefix)) {
                const commandName = text.slice(prefix.length).split(' ')[0].toLowerCase();
                const command = commands.get(prefix + commandName);

                if (command) {
                    try {
                        logger.info(`[Bot] Exécution de la commande '${commandName}' depuis ${from}`);
                        await command.execute(sock, from, msg);
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

