// qr.js (MODIFIÉ)
const { makeid } = require('./gen-id');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
let router = express.Router();
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const { upload } = require('./mega');

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
  const id = makeid();
  let qrSent = false;

  const sessionPath = `./session/${id}`;
  fs.mkdirSync(sessionPath, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    let sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Desktop'),
    });

    sock.ws?.on('error', (err) => console.error('[qr.js] ws error', err));

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (s) => {
      const { connection, lastDisconnect, qr } = s;

      if (qr && !qrSent) {
        try {
          const qrBase64 = await QRCode.toDataURL(qr);
          qrSent = true;
          if (!res.headersSent) res.json({ qrCode: qrBase64, sessionId: id });
        } catch (e) {
          console.error('[qr.js] QR encode error', e);
          if (!res.headersSent) res.status(500).json({ error: 'QR generation failed' });
        }
      }

      if (connection === 'open') {
        // upload creds if present (non-blocking)
        const rf = `${sessionPath}/creds.json`;
        if (fs.existsSync(rf)) {
          try {
            const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
            console.log('[qr.js] uploaded creds ->', mega_url);
          } catch (e) {
            console.error('[qr.js] upload error', e);
          }
        }

        console.log('[qr.js] socket open, session persisted at', sessionPath);
        // keep the socket alive; do not process.exit()
      }

      if (connection === 'close') {
        console.log('[qr.js] connection closed', lastDisconnect?.error || lastDisconnect);
        if (lastDisconnect?.error?.output?.statusCode === 515) {
          console.warn('[qr.js] 515 - removing session');
          try { removeFile(sessionPath); } catch (e) { console.error(e); }
        }
      }
    });

  } catch (err) {
    console.error('[qr.js] error', err);
    if (!res.headersSent) res.status(503).json({ error: 'Service unavailable', details: err.message });
  }
});

module.exports = router;