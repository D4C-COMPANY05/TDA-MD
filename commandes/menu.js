const command = {
    name: '!menu',
    description: 'Affiche la liste des commandes disponibles.',
    async execute(sock, jid) {
        const menuMessage = `
Voici les commandes disponibles :
*!menu* - Affiche ce menu.
*!aide* - Demander de l'aide.
*!info* - Afficher des informations sur le bot.
`;
        await sock.sendMessage(jid, { text: menuMessage.trim() });
    },
};

module.exports = command;

