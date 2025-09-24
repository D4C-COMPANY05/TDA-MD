const mega = require("megajs");
const fs = require("fs");

let email = 'd4c.company05@gmail.com'; 
let pw = 'Anne-2005-12'; 

async function upload(stream, filename) {
    return new Promise((resolve, reject) => {
        const storage = new mega.Storage({
            email: email,
            password: pw
        });

        storage.on('ready', () => {
            console.log("✅ Mega storage ready. Starting upload...");
            
            // Corrige le problème en autorisant la mise en mémoire tampon
            const uploadStream = storage.upload({ 
                name: filename,
                allowUploadBuffering: true 
            }, stream);

            uploadStream.on('complete', () => {
                console.log(`✅ File uploaded successfully: ${filename}`);
                resolve(uploadStream.file.link);
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

