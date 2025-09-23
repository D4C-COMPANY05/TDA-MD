const mega = require("megajs");
const fs = require("fs");

let email = 'd4c.company05@gmail.com'; // email du compte Mega
let pw = 'Anne-2005!'; // mot de passe Mega

// Fonction pour uploader un fichier local sur Mega
async function upload(stream, filename) {
    return new Promise((resolve, reject) => {
        const file = new mega.File({ 
            name: filename, 
            parent: 'root' // tu peux créer un dossier spécifique si tu veux
        }, (err) => {
            if (err) return reject(err);
        });

        // Se connecter au compte Mega
        const storage = new mega.Storage({
            email: email,
            password: pw
        });

        storage.on('ready', () => {
            const uploadStream = file.upload(); // flux d'upload
            stream.pipe(uploadStream);

            file.on('complete', () => {
                resolve(file.link); // lien du fichier uploadé
            });

            file.on('error', reject);
        });

        storage.on('error', reject);
    });
}

module.exports = { upload };