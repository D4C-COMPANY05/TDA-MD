const mega = require("megajs");
const fs = require("fs");

let email = 'd4c.company05@gmail.com'; // email du compte Mega
let pw = 'Anne-2005-12'; // mot de passe Mega

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

            uploadStream.on('complete', (file) => {
                console.log(`✅ File uploaded successfully: ${filename}`);
                // On s'assure que le lien est bien un string
                if (file && file.link) {
                    file.link((err, link) => {
                        if (err) {
                            return reject(err);
                        }
                        console.log("Generated Mega link:", link);
                        resolve(link);
                    });
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

