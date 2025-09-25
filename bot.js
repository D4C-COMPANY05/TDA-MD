// bot.js (MODIFIÉ)
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const SESSION_DIR = './session';

async function startBot() {
  // Vérifier si la session existe
  if (!fs.existsSync(SESSION_DIR)) {
    console.log('❌ Le bot n\'a pas de session. Veuillez d\'abord vous connecter via un QR code ou un code d\'appariement.');
    return; // ne kill pas le process
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    let sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'fatal' }),
      browser: Browsers.macOS('StartBot'),
    });

    sock.ws?.on('error', (err) => console.error('[bot.js] ws error', err));

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
      console.log('[bot.js] connection.update', u);
      if (u.connection === 'open') console.log('[bot.js] connected.');
      if (u.connection === 'close') console.log('[bot.js] disconnected', u.lastDisconnect?.error || u.lastDisconnect);
    });

    // exemple: listener messages
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const messages = m.messages || [];
        for (const msg of messages) {
          // ignore messages without key
          if (!msg.key) continue;
          const senderId = msg.key.remoteJid;
          const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
          if (!text) continue;

          if (text === '!ping') {
            await sock.sendMessage(senderId, { text: 'pong' });
          }
        }
      } catch (e) {
        console.error('[bot.js] messages.upsert error', e);
      }
    });

  } catch (err) {
    console.error('[bot.js] start error', err);
  }
}

startBot();

module.exports = { startBot };