// server.js
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');          // sécurise les headers HTTP
const path = require('path');
const cors = require('cors');


const app = express();
const PORT = process.env.PORT || 8000;
const __root = process.cwd();

// ↑↑↑ modules ↑↑↑
const server = require('./qr');
const code = require('./pair');

// éviter les warnings EventEmitter
require('events').EventEmitter.defaultMaxListeners = 500;

// middlewares globaux
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// modules montés sous des routes
app.use('/server', server);
app.use('/code', code);

// gestion des erreurs 404
app.use((req, res, next) => {
  res.status(404).send('Page non trouvée');
});

// gestion des erreurs serveur
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Erreur interne du serveur');
});

// lancement du serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré : http://localhost:${PORT}`);
});

module.exports = app;