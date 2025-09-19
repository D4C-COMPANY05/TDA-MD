const command = {
    name: '!aide',
    description: 'Fournit de l\'aide sur l\'utilisation du bot.',
    async execute(sock, jid) {
        const helpMessage = `
Je suis un bot WhatsApp simple et efficace.
Si vous avez besoin d'aide, vous pouvez utiliser les commandes suivantes :
- Pour une liste des commandes : !menu
- Pour des informations sur le bot : !info
`;
        await sock.sendMessage(jid, { text: helpMessage.trim() });
    },
};

module.exports = command;

