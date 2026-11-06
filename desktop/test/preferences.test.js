'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const preferences = require('../src/preferences');
const tokens = require('../src/token-store');
const webroot = require('../src/webroot');
const macho = require('../src/macho');

test('window state stays inside a normal desktop window', () => {
  const clamped = preferences.clampBounds({ width: 10, height: 9000, x: -20, y: 50, alwaysOnTop: 'yes', isFullScreen: 1 });
  assert.equal(clamped.width, 480);
  assert.equal(clamped.height, 3000);
  assert.equal(clamped.x, -20);
  assert.equal(clamped.y, 50);
  assert.equal(clamped.alwaysOnTop, false);
  assert.equal(clamped.isFullScreen, false);
  assert.deepEqual(preferences.clampBounds(null).width, preferences.DEFAULT_BOUNDS.width);
});

test('mode file stores only demo or cloud', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-mode-'));
  const file = path.join(dir, 'checklist-mode.json');
  preferences.writeMode(file, 'demo');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"mode":"demo"}\n');
  assert.equal(preferences.readMode(file), 'demo');
  preferences.writeMode(file, 'cloud');
  assert.equal(preferences.readMode(file), 'cloud');
  preferences.writeMode(file, 'delete-everything');
  assert.equal(fs.existsSync(file), false);
  assert.equal(preferences.readMode(file), null);
});

test('encrypted token store refuses plaintext and round-trips ciphertext', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-tokens-'));
  const file = path.join(dir, 'microsoft-session.bin');
  const refused = tokens.createEncryptedTokenStore({
    file: file,
    encrypt: function () { return null; },
    decrypt: function () { throw new Error('unused'); }
  });
  await assert.rejects(() => refused.write({ accessToken: 'access-test', refreshToken: 'refresh-test' }), /OS encryption/);
  assert.equal(fs.existsSync(file), false);

  function mask(value) {
    const out = Buffer.from(value);
    for (let i = 0; i < out.length; i++) out[i] ^= 0x5a;
    return out;
  }
  const store = tokens.createEncryptedTokenStore({
    file: file,
    encrypt: function (text) { return mask(text); },
    decrypt: function (buffer) { return mask(buffer).toString('utf8'); }
  });
  await store.write({ accessToken: 'access-test', refreshToken: 'refresh-test', account: 'person@example.test', expiresAt: 1 });
  const raw = fs.readFileSync(file);
  assert.equal(raw.includes('access-test'), false);
  assert.equal(raw.includes(Buffer.from('access-test')), false);
  const read = await store.read();
  assert.equal(read.account, 'person@example.test');
  await store.clear();
  assert.equal(fs.existsSync(file), false);
});

test('web root allow-list rejects traversal and private files', () => {
  const root = path.join(__dirname, '..', '..');
  assert.equal(path.basename(webroot.resolveWebFile(root, '/index.html')), 'index.html');
  assert.equal(webroot.resolveWebFile(root, '/../config.js'), null);
  assert.equal(webroot.resolveWebFile(root, '/icons/../../.git/config'), null);
  assert.equal(webroot.resolveWebFile(root, '/desktop/src/main.js'), null);
  assert.equal(webroot.resolveWebFile(root, '/%2e%2e/config.js'), null);
  assert.equal(webroot.resolveWebFile(root, '/sample-checklist.json').endsWith('sample-checklist.json'), true);
});

test('Mach-O parser reports an arm64 macOS minimum version', () => {
  const header = Buffer.alloc(32 + 24);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(1, 16);
  header.writeUInt32LE(24, 20);
  header.writeUInt32LE(0x32, 32);
  header.writeUInt32LE(24, 36);
  header.writeUInt32LE(1, 40);
  header.writeUInt32LE(13 << 16, 44);
  header.writeUInt32LE(14 << 16, 48);
  const parsed = macho.parseMachO(header);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.arch, 'arm64');
  assert.equal(parsed.platform, 'macos');
  assert.equal(parsed.minos, '13.0.0');
  const intel = Buffer.from(header);
  intel.writeUInt32LE(0x01000007, 4);
  assert.equal(macho.parseMachO(intel).arch, 'x64');
  assert.equal(macho.parseMachO(intel).ok, false);
});
