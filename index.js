// index.js - charge les commandes et fournit un handler de base pour les messages
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const { BOT, PREFIXE } = require('./config');

const commands = new Map();

// Charge toutes les commandes du dossier ./commandes
const commandesDir = path.join(__dirname, 'commandes');
if (fs.existsSync(commandesDir)) {
  const files = fs.readdirSync(commandesDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    try {
      const cmdPath = path.join(commandesDir, file);
      const cmd = require(cmdPath);
      if (cmd && cmd.name) {
        commands.set(cmd.name, cmd);
        logger.info(`[index] Commande chargée: ${cmd.name}`);
      } else {
        logger.warn(`[index] Fichier commande ${file} ne contient pas de "name" export.`);
      }
    } catch (e) {
      logger.error(`[index] Erreur chargement commande ${file}:`, e);
    }
  }
} else {
  logger.warn('[index] Dossier commandes introuvable.');
}

/**
 * Exemple générique d'un handler qui peut être branché à ton socket/baileys:
 * - from: identifiant de la conversation
 * - sock: instance Baileys / objet qui a sendMessage
 * - message: texte du message
 * - msg: objet message brut (optionnel, utilisé pour quoted)
 */
const handleBotMessages = async ({ from, sock, message, msg = null }) => {
  try {
    if (!message || !message.startsWith(PREFIXE)) return;

    const args = message.slice(PREFIXE.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const command = commands.get(commandName);
    if (!command) {
      return await sock.sendMessage(from, { text: `❌ Commande inconnue. Tape ${PREFIXE}aide pour la liste.` }, { quoted: msg });
    }

    // Construis un objet contextuel simple
    const context = { from, args, sock, msg, prefix: PREFIXE, logger };
    logger.info(`[index] Exécution commande ${commandName} depuis ${from}`);
    await command.action(context);
  } catch (err) {
    logger.error('[index] Erreur handleBotMessages:', err);
    if (sock && from) {
      try { await sock.sendMessage(from, { text: '⚠️ Une erreur est survenue lors de l’exécution de la commande.' }, { quoted: msg }); } catch {}
    }
  }
};

module.exports = { commands, handleBotMessages, PREFIXE, BOT };