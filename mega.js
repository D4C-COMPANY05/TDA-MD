const mega = require("megajs");
const fs = require("fs");

let email = 'd4c.company05@gmail.com'; 
let pw = 'Anne-2005!'; 

async function upload(stream, filename) {
    return new Promise((resolve, reject) => {
        const storage = new mega.Storage({
            email: email,
            password: pw
        });

        storage.on('ready', () => {
            console.log("✅ Mega storage ready. Starting upload...");
            
            const uploadStream = storage.upload({ 
                name: filename,
                allowUploadBuffering: true 
            }, stream);

            uploadStream.on('complete', () => {
                console.log(`✅ File uploaded successfully: ${filename}`);
                // Corrigé: on récupère le lien de l'objet uploadStream
                resolve(uploadStream.publicUrl);
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

