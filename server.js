const express = require('express');
const cors = require('cors');
const app = express();
__path = process.cwd();
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;

// tes routes Node
let server = require('./qr'),
    code = require('./pair');

// augmente le max listeners pour éviter les warnings
require('events').EventEmitter.defaultMaxListeners = 500;

// active CORS pour permettre les appels cross-domain
app.use(cors());

// parsers
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// monte tes routes back
app.use('/server', server);
app.use('/code', code);

// redirection vers ton front hébergé sur un autre domaine
const FRONT_DOMAIN = 'https://tda-md.vercel.app/'; // <-- remplace par ton vrai domaine

app.get('/pair', (req, res) => {
  res.redirect(FRONT_DOMAIN + '/pair.html');
});

app.get('/qr', (req, res) => {
  res.redirect(FRONT_DOMAIN + '/qr.html');
});

app.get('/', (req, res) => {
  res.redirect(FRONT_DOMAIN + '/main.html');
});

// démarre le serveur
app.listen(PORT, () => {
  console.log(`
✅ TDA XMD Server running on http://localhost:${PORT}
(⭐ N'oubliez pas de soutenir le projet TDA XMD sur GitHub)
`);
});

module.exports = app;