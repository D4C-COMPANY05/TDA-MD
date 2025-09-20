require('dotenv').config();

module.exports = {
  BOT: process.env.BOT_NAME || "TDA-MD",
  PREFIXE: process.env.PREFIXE || ".",
  NOM_OWNER: process.env.OWNER || "Kiyotaka Ayanokoji",
  MODE: process.env.MODE || "dev",
  PORT: process.env.PORT || 3000,
  SOCKET_TOKEN: process.env.SOCKET_TOKEN || null
};