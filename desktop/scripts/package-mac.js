'use strict';

// Zip (and, on a Mac, disk-image) the already-built arm64 .app.
// Signing is intentionally not done here: Linux cannot codesign, and the
// macOS CI job signs with an ad-hoc signature before calling this script.

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const macho = require('../src/macho');

const desktop = path.join(__dirname, '..');
const dist = path.join(desktop, 'dist');
const app = path.join(dist, 'mac-arm64', 'Checklist Sticky.app');
const zip = path.join(dist, 'Checklist-Sticky-mac-arm64.zip');
const plist = path.join(app, 'Contents', 'Info.plist');
const exe = path.join(app, 'Contents', 'MacOS', 'Checklist Sticky');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function walk(dir, found) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    found.push(full);
    if (stat.isDirectory() && !stat.isSymbolicLink()) walk(full, found);
  }
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

if (!fs.existsSync(exe)) fail('Missing ' + exe + '. Run electron-builder --mac dir --arm64 first.');

const header = Buffer.alloc(4096);
const fd = fs.openSync(exe, 'r');
fs.readSync(fd, header, 0, 4096, 0);
fs.closeSync(fd);
const parsed = macho.parseMachO(header);
if (!parsed.ok || parsed.arch !== 'arm64') fail('Main executable is not a thin arm64 macOS binary: ' + JSON.stringify(parsed));

const plistText = fs.readFileSync(plist, 'utf8');
if (!plistText.includes('<string>13.0</string>')) fail('Info.plist is missing LSMinimumSystemVersion 13.0');
if (/LSUIElement[\s\S]{0,80}<true\s*\/>/.test(plistText)) fail('App is marked as an agent and would not show in the Dock');

const bundledSample = path.join(app, 'Contents', 'Resources', 'web', 'sample-checklist.json');
const repoSample = path.join(desktop, '..', 'sample-checklist.json');
if (!fs.existsSync(bundledSample)) fail('Sample checklist fixture was not packaged');
if (sha256(bundledSample) !== sha256(repoSample)) fail('Packaged sample checklist does not match the repo fixture');

const files = [];
walk(app, files);
const rel = files.map(file => path.relative(app, file));
const bannedName = rel.find(file => /(^|\/)\.git(\/|$)|(^|\/)\.env$|webtest|id_token|refresh_token|node_modules/.test(file));
if (bannedName) fail('Unexpected packaged path: ' + bannedName);

const bannedText = ['x-access-token', 'BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY', 'github_pat_', 'ghp_'];
for (const file of files) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 2000000) continue;
  if (!/\.(js|json|plist|html|yml|txt|md)$/i.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const needle of bannedText) {
    if (text.includes(needle)) fail('Sensitive marker ' + needle + ' in ' + path.relative(app, file));
  }
}

if (fs.existsSync(zip)) fs.unlinkSync(zip);
const zipResult = spawnSync('zip', ['-y', '-r', '-X', zip, 'Checklist Sticky.app'], {
  cwd: path.dirname(app),
  stdio: 'inherit'
});
if (zipResult.status !== 0) fail('zip failed');

let dmg = null;
if (process.platform === 'darwin') {
  dmg = path.join(dist, 'Checklist-Sticky-mac-arm64.dmg');
  if (fs.existsSync(dmg)) fs.unlinkSync(dmg);
  const dmgResult = spawnSync('hdiutil', ['create', '-volname', 'Checklist Sticky', '-srcfolder', app, '-ov', '-format', 'UDZO', dmg], { stdio: 'inherit' });
  if (dmgResult.status !== 0) fail('hdiutil failed');
}

const report = {
  product: 'Checklist Sticky',
  version: require(path.join(desktop, 'package.json')).version,
  arch: parsed.arch,
  machoPlatform: parsed.platform,
  minimumOs: '13.0',
  machoMinos: parsed.minos,
  machoSdk: parsed.sdk,
  builtOn: process.platform + ' ' + process.arch,
  signing: process.env.CHECKLIST_SIGNATURE || 'unsigned',
  notarized: false,
  zip: { file: path.basename(zip), bytes: fs.statSync(zip).size, sha256: sha256(zip) },
  dmg: dmg ? { file: path.basename(dmg), bytes: fs.statSync(dmg).size, sha256: sha256(dmg) } : null
};
fs.writeFileSync(path.join(dist, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'),
  report.zip.sha256 + '  ' + report.zip.file + '\n' +
  (report.dmg ? report.dmg.sha256 + '  ' + report.dmg.file + '\n' : ''));
console.log(JSON.stringify(report, null, 2));
