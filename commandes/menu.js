const os = require("os");
const moment = require("moment-timezone");
const { BOT, PREFIXE, NOM_OWNER, MODE } = require("../set"); // adapte si ton fichier s’appelle différemment

// Fonction format mémoire
const format = (bytes) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
    return `${Math.round(bytes / (1024 ** i), 2)} ${sizes[i]}`;
};

module.exports = {
    nomCom: "menu",
    categorie: "Général",
    reaction: "📁",

    fonction: async (dest, zk, options) => {
        let { ms, repondre, prefixe, nomAuteurMessage, mybotpic } = options;

        // Déterminer le mode
        let mode = (MODE.toLowerCase() === "oui") ? "public" : "privé";

        // Date et heure
        moment.tz.setDefault('Etc/GMT');
        const temps = moment().format('HH:mm:ss');
        const date = moment().format('DD/MM/YYYY');

        // Récupérer la liste des commandes depuis la Map
        const { commands } = require("../index"); // exporte la Map depuis index.js
        const coms = {};
        for (const [, cmd] of commands) {
            if (!coms[cmd.categorie]) coms[cmd.categorie] = [];
            coms[cmd.categorie].push(cmd.nomCom);
        }

        // Info du bot
        let infoMsg = `
╭────✧${BOT}✧────◆
│   *Préfixe* : ${PREFIXE}
│   *Owner* : ${NOM_OWNER}
│   *Mode* : ${mode}
│   *Commandes* : ${commands.size}
│   *Date* : ${date}
│   *Heure* : ${temps}
│   *Mémoire* : ${format(os.totalmem() - os.freemem())}/${format(os.totalmem())}
│   *Plateforme* : ${os.platform()}
│   *Développeurs* : Kiyotaka Ayanokoji
╰─────✧WA-BOT✧─────◆\n\n`;

        // Construction du menu
        let menuMsg = `
👋 Salut ${nomAuteurMessage} 👋

*Voici la liste de mes commandes :*
◇                             ◇
`;

        for (const cat in coms) {
            menuMsg += `╭────❏ *${cat}* ❏`;
            for (const cmd of coms[cat]) {
                menuMsg += `\n│ ${cmd}`;
            }
            menuMsg += `\n╰═════════════⊷ \n`;
        }

        menuMsg += `
◇            ◇
*»»————— ★ —————««*
Pour utiliser une commande, tapez ${prefixe}"nom de la commande"
*»»————— ★ —————««*
`;

        // Image/vidéo si dispo
        const lien = mybotpic();

        try {
            if (/\.(mp4|gif)$/i.test(lien)) {
                await zk.sendMessage(dest, {
                    video: { url: lien },
                    caption: infoMsg + menuMsg,
                    gifPlayback: true
                }, { quoted: ms });
            } else if (/\.(jpeg|png|jpg)$/i.test(lien)) {
                await zk.sendMessage(dest, {
                    image: { url: lien },
                    caption: infoMsg + menuMsg
                }, { quoted: ms });
            } else {
                repondre(infoMsg + menuMsg);
            }
        } catch (e) {
            console.error("🥵🥵 Menu erreur " + e);
            repondre("🥵🥵 Menu erreur " + e);
        }
    }
};