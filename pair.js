// pair.js (MODIFIÉ)
const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { upload } = require('./mega');

// Simple in-memory lock map to prevent concurrent pairings for same number
const pairingLocks = {}; // number -> sessionId

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
  const id = makeid();
  let num = (req.query.number || '').toString();
  if (!num) return res.status(400).json({ error: 'number query param required' });

  num = num.replace(/[^0-9]/g, '');

  // Prevent concurrent pairing for same number
  if (pairingLocks[num]) return res.status(409).json({ error: 'Pairing already in progress for this number' });
  pairingLocks[num] = id;

  const sessionPath = `./session/${id}`;
  try {
    fs.mkdirSync(sessionPath, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const items = ["Safari"];
    const randomItem = items[Math.floor(Math.random() * items.length)];

    let sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })) },
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
      logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
      syncFullHistory: false,
      browser: Browsers.macOS(randomItem),
    });

    // WebSocket errors
    sock.ws?.on('error', (err) => {
      console.error('[pair.js] ws error:', err);
    });

    sock.ev.on('creds.update', saveCreds);

    let responded = false;
    let requested = false;

    // Wait for socket handshake / open
    sock.ev.on('connection.update', async (update) => {
      try {
        console.log('[pair.js] connection.update', update);
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          // As soon as socket is open, request pairing code (if not registered)
          if (!sock.authState?.creds?.registered && !requested) {
            requested = true;
            try {
              const code = await sock.requestPairingCode(num);
              if (!responded && !res.headersSent) {
                responded = true;
                res.json({ code, sessionId: id });
              }
            } catch (err) {
              console.error('[pair.js] requestPairingCode error:', err);
              if (!responded && !res.headersSent) {
                responded = true;
                res.status(500).json({ error: 'Failed to request pairing code', details: err.message });
              }
            }
          } else {
            // If already registered, tell client session exists
            if (!responded && !res.headersSent) {
              responded = true;
              res.json({ message: 'Session already registered', sessionId: id });
            }
          }
        }

        if (connection === 'close') {
          console.log('[pair.js] connection closed', lastDisconnect?.error || lastDisconnect);
          if (lastDisconnect?.error?.output?.statusCode === 515) {
            console.warn('[pair.js] Detected 515 -> removing session');
            try { removeFile(sessionPath); } catch (e) { console.error(e); }
            if (!responded && !res.headersSent) {
              responded = true;
              res.json({ code: '🔄 Session reset, re-pair required', sessionId: id });
            }
          } else {
            // other closes: ensure client isn't left hanging
            if (!responded && !res.headersSent) {
              responded = true;
              res.status(503).json({ error: 'connection closed', details: lastDisconnect?.error?.toString?.() || lastDisconnect });
            }
          }
        }

        // When connected, try to upload creds if they exist (non-blocking)
        if (connection === 'open') {
          const rf = `${sessionPath}/creds.json`;
          if (fs.existsSync(rf)) {
            (async () => {
              try {
                const mega_url = await upload(fs.createReadStream(rf), `${sock.user.id}.json`);
                console.log('[pair.js] uploaded creds to mega', mega_url);
              } catch (e) {
                console.error('[pair.js] upload error', e);
              }
            })();
          }
        }

      } catch (e) {
        console.error('[pair.js] connection.update handler error', e);
      }
    });

  } catch (err) {
    console.error('[pair.js] main error', err);
    if (!res.headersSent) res.status(503).json({ code: '❗ Service Unavailable', error: err.message });
  } finally {
    // release lock
    if (pairingLocks[num] === id) delete pairingLocks[num];
  }
});

module.exports = router;