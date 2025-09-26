// Importations de modules
const express = require('express');
const cors = require('cors'); 
const app = express();
const bodyParser = require("body-parser");

// Configuration de base
const PORT = process.env.PORT || 8000;
const __path = process.cwd();

// Importation des modules de routage locaux
let server = require('./qr'), 
    code = require('./pair'); 
    
// --- Middlewares ---
// Middleware CORS : essentiel pour les requêtes cross-origin
app.use(cors()); 

// Middleware Body Parser : pour traiter les corps de requêtes (JSON et URL-encoded)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Routes des modules ---
app.use('/server', server);
app.use('/code', code);

// --- Routes des fichiers HTML statiques ---

// Route pour l'appariement
app.use('/pair', (req, res) => {
    res.sendFile(__path + '/pair.html')
});

// Route pour le code QR
app.use('/qr', (req, res) => {
    res.sendFile(__path + '/qr.html')
});

// Route principale (racine)
app.use('/', (req, res) => {
    res.sendFile(__path + '/main.html')
});

// --- Démarrage du serveur ---
app.listen(PORT, () => {
    console.log(`Serveur Express démarré sur http://localhost:${PORT}`)
})

module.exports = app

