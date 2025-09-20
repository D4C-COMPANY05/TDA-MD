// commandes/menu.js
const os = require('os');
const { BOT, PREFIXE, NOM_OWNER, MODE } = require('../config');

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

module.exports = {
  name: 'menu',
  description: 'Affiche le menu et l’état du bot',
  action: async ({ from, sock, args, msg }) => {
    const uptime = process.uptime();
    const cpu = os.cpus()[0].model;
    const freemem = formatBytes(os.freemem());
    const totalmem = formatBytes(os.totalmem());

    const text = `🤖 *${BOT}* — Menu
Préfixe: \`${PREFIXE}\`
Owner: ${NOM_OWNER}
Mode: ${MODE}

Uptime: ${Math.floor(uptime)}s
CPU: ${cpu}
Mémoire: ${freemem} / ${totalmem}

Tape \`${PREFIXE}aide\` pour la liste des commandes.
`;

    await sock.sendMessage(from, { text }, { quoted: msg });
  }
};