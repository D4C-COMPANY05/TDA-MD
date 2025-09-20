// commandes/aide.js
const { PREFIXE } = require('../config');

module.exports = {
  name: 'aide',
  description: 'Affiche l’aide et les commandes disponibles',
  action: async ({ from, sock, args, msg }) => {
    const helpText = `
Voici les commandes disponibles :

• \`${PREFIXE}menu\` — Affiche le menu du bot et infos système.
• \`${PREFIXE}aide\` — Affiche ce message d'aide.

Ajoute d'autres commandes dans le dossier /commandes.
`;
    await sock.sendMessage(from, { text: helpText }, { quoted: msg });
  }
};