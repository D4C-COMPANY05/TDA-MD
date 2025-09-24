const mega = require("megajs");
const fs = require("fs");

let email = 'd4c.company05@gmail.com'; // email du compte Mega
let pw = 'Anne-2005-12'; // mot de passe Mega

// Fonction pour uploader un fichier local sur Mega
async function upload(stream, filename) {
    return new Promise((resolve, reject) => {
        const storage = new mega.Storage({
            email: email,
            password: pw
        });

        storage.on('ready', () => {
            console.log("✅ Mega storage ready. Starting upload...");
            
            // Crée un flux d'upload qui peut mettre le fichier en mémoire tampon si la taille n'est pas spécifiée.
            const uploadStream = storage.upload({ 
                name: filename,
                allowUploadBuffering: true 
            }, stream);

            uploadStream.on('complete', (file) => {
                console.log(`✅ File uploaded successfully: ${filename}`);
                // Corrigé: On utilise l'objet 'file' retourné par l'événement 'complete'
                if (file && file.link) {
                    // On convertit explicitement le lien en chaîne de caractères
                    resolve(file.link.toString()); 
                } else {
                    reject(new Error("Failed to get file link from Mega upload."));
                }
            });

            uploadStream.on('error', (err) => {
                console.error("❌ Mega upload error:", err);
                reject(err);
            });
        });

        storage.on('error', (err) => {
            console.error("❌ Mega storage error:", err);
            reject(err);
        });
    });
}

module.exports = { upload };

