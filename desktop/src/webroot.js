'use strict';

const path = require('path');

// Files the desktop window is allowed to load. Anything else, including
// parent directories and the desktop shell itself, is refused.
const ALLOWED = new Set([
  'index.html',
  'app.js',
  'style.css',
  'merge.js',
  'config.js',
  'sample-checklist.json',
  'manifest.webmanifest',
  'favicon.ico',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-transparent.png',
  'icons/favicon-64.png',
  'vendor/msal-browser-3.30.0.min.js'
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function contentType(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function resolveWebFile(root, pathname) {
  let rel = String(pathname || '');
  if (rel.includes('\0') || rel.includes('\\')) return null;
  try { rel = decodeURIComponent(rel); } catch (e) { return null; }
  if (rel === '/' || rel === '') rel = 'index.html';
  rel = rel.replace(/^\/+/, '');
  const parts = [];
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  rel = parts.join('/');
  if (!ALLOWED.has(rel)) return null;
  const rootResolved = path.resolve(root);
  const file = path.resolve(rootResolved, rel);
  if (file !== rootResolved && !file.startsWith(rootResolved + path.sep)) return null;
  return file;
}

module.exports = { ALLOWED, contentType, resolveWebFile };
