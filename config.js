require('dotenv').config();

module.exports = {
  BOT: process.env.BOT_NAME || "TDA-MD",
  PREFIXE: process.env.PREFIXE || ".",
  NOM_OWNER: process.env.OWNER || "Kiyotaka Ayanokoji",
  MODE: process.env.MODE || "dev",
  PORT: process.env.PORT || 3000,
  SOCKET_TOKEN: process.env.SOCKET_TOKEN || null,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY
};

