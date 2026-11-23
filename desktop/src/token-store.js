'use strict';

const fs = require('fs');
const path = require('path');

function createMemoryTokenStore() {
  let tokens = null;
  return {
    persistent: false,
    read: async function () { return tokens ? Object.assign({}, tokens) : null; },
    write: async function (next) { tokens = Object.assign({}, next); },
    clear: async function () { tokens = null; }
  };
}

// Refuses to write when encryption is unavailable. Callers can fall back to
// the memory store; plaintext Microsoft tokens are never written to disk.
function createEncryptedTokenStore(options) {
  const file = options.file;
  const encrypt = options.encrypt;
  const decrypt = options.decrypt;
  return {
    persistent: true,
    read: async function () {
      if (!fs.existsSync(file)) return null;
      const raw = fs.readFileSync(file);
      const decoded = await Promise.resolve(decrypt(raw));
      const json = decoded && typeof decoded === 'object' && decoded.result != null ? decoded.result : decoded;
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.accessToken !== 'string') return null;
      return parsed;
    },
    write: async function (tokens) {
      const encrypted = await Promise.resolve(encrypt(JSON.stringify(tokens)));
      if (!encrypted || !encrypted.length) {
        const err = new Error('Refusing to store Microsoft tokens without OS encryption.');
        err.code = 'token-storage';
        throw err;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, encrypted, { mode: 0o600 });
    },
    clear: async function () {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  };
}

module.exports = { createMemoryTokenStore, createEncryptedTokenStore };
