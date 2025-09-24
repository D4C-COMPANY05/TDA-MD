const mega = require("megajs");
const fs = require("fs");

let email = 'd4c.company05@gmail.com'; // email du compte Mega
let pw = 'Anne-2005!'; // mot de passe Mega

// Fonction pour uploader un fichier local sur Mega
async function upload(stream, filename) {
    return new Promise((resolve, reject) => {
        // Se connecter au compte Mega
        const storage = new mega.Storage({
            email: email,
            password: pw
        });

        storage.on('ready', () => {
            console.log("✅ Mega storage ready. Starting upload...");
            // Utilisez la méthode upload() de l'objet storage, qui prend le flux de données
            const uploadStream = storage.upload({ name: filename }, stream);

            uploadStream.on('complete', () => {
                console.log(`✅ File uploaded successfully: ${filename}`);
                resolve(uploadStream.file.link); // lien du fichier uploadé
            });

            uploadStream.on('error', reject);
        });

        storage.on('error', (err) => {
            console.error("❌ Mega storage error:", err);
            reject(err);
        });
    });
}

module.exports = { upload };

