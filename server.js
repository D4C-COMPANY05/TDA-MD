const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');          // sécurise les headers HTTP
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8000;

// Définir le chemin d'accès au dossier de session du bot
const SESSION_DIR = './session';

// modules
const server = require('./qr');
const code = require('./pair');

// Éviter les warnings EventEmitter
require('events').EventEmitter.defaultMaxListeners = 500;

// Middlewares globaux
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Lancer le bot s'il existe une session
function startBotProcess() {
    if (fs.existsSync(SESSION_DIR)) {
        console.log("Session trouvée. Démarrage du bot...");
        const botProcess = spawn('node', ['bot.js'], { stdio: 'inherit' });
    } else {
        console.log("Aucune session trouvée. Le bot attend une connexion.");
    }
}

// modules montés sous des routes
app.use('/server', server);
app.use('/code', code);

// Gestion des erreurs 404
app.use((req, res, next) => {
  res.status(404).send('Page non trouvée');
});

// Gestion des erreurs serveur
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Erreur interne du serveur');
});

// Lancement du serveur et du bot
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré : http://localhost:${PORT}`);
  startBotProcess();
});

module.exports = app;

