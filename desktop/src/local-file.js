'use strict';

// Local OneDrive folder access. Reads and replaces checklist.json on disk.
// No network. Does not create the checklist, does not delete or rename anything
// except the atomic replace of checklist.json and one daily backup file.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SF_DATALESS = 0x40000000;
const DATALESS_MESSAGE = 'This checklist is online-only in OneDrive. In Finder, right-click checklist.json, choose Always Keep on This Device, and try again. Nothing was changed.';
const CHECKLIST_NAME = 'checklist.json';
const FOLDER_NAME = 'Checklist Sticky';

// The Windows app's backup names are not in this repository. If Backups already
// contains dated copies, follow that pattern. Otherwise use checklist-YYYY-MM-DD.json.
const BACKUP_PATTERNS = [
  { re: /^checklist-\d{4}-\d{2}-\d{2}\.json$/, format: function (day) { return 'checklist-' + day + '.json'; } },
  { re: /^checklist_\d{4}-\d{2}-\d{2}\.json$/, format: function (day) { return 'checklist_' + day + '.json'; } },
  { re: /^\d{4}-\d{2}-\d{2}\.json$/, format: function (day) { return day + '.json'; } },
  { re: /^checklist\.json\.\d{4}-\d{2}-\d{2}$/, format: function (day) { return 'checklist.json.' + day; } },
  { re: /^checklist-\d{8}\.json$/, format: function (day) { return 'checklist-' + day.replace(/-/g, '') + '.json'; } },
  { re: /^checklist_\d{8}\.json$/, format: function (day) { return 'checklist_' + day.replace(/-/g, '') + '.json'; } }
];

function datalessError() {
  const err = new Error(DATALESS_MESSAGE);
  err.dataless = true;
  return err;
}

function notFoundError() {
  const err = new Error('not found');
  err.notFound = true;
  return err;
}

function isDatalessStat(stat) {
  if (!stat) return false;
  if (typeof stat.flags === 'number' && (stat.flags & SF_DATALESS) !== 0) return true;
  return stat.size > 0 && stat.blocks === 0;
}

function stripBom(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3);
  return buf;
}

function hashBytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function serializeChecklist(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Refusing to save a non-object checklist.');
  }
  const text = JSON.stringify(data, null, 2);
  const buf = Buffer.from(text, 'utf8');
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    throw new Error('Refusing to write a BOM.');
  }
  if (buf.length > 8000000) throw new Error('Refusing to save a checklist larger than 8 MB.');
  return buf;
}

function localDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + month + '-' + day;
}

function inferBackupName(existingNames, day) {
  let best = null;
  let bestCount = 0;
  for (let i = 0; i < BACKUP_PATTERNS.length; i++) {
    const pattern = BACKUP_PATTERNS[i];
    let count = 0;
    for (let n = 0; n < (existingNames || []).length; n++) {
      if (pattern.re.test(existingNames[n])) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = pattern;
    }
  }
  const name = best ? best.format(day) : ('checklist-' + day + '.json');
  if (!name || name === CHECKLIST_NAME || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('Refusing an unexpected backup name.');
  }
  return name;
}

function checklistFileIn(folder) {
  if (typeof folder !== 'string' || !folder) return null;
  const root = path.resolve(folder);
  const file = path.resolve(root, CHECKLIST_NAME);
  if (path.dirname(file) !== root || path.basename(file) !== CHECKLIST_NAME) return null;
  return file;
}

function findCandidateFiles(home, io) {
  const cloud = path.join(home, 'Library', 'CloudStorage');
  let entries = [];
  try {
    entries = io.readdir(cloud);
  } catch (e) {
    return [];
  }
  const found = [];
  entries.forEach(function (name) {
    if (typeof name !== 'string' || !name.startsWith('OneDrive')) return;
    const file = path.join(cloud, name, FOLDER_NAME, CHECKLIST_NAME);
    try {
      const stat = io.lstat(file);
      if (stat && stat.isFile() && !stat.isSymbolicLink()) found.push(file);
    } catch (e) { /* not this account */ }
  });
  found.sort();
  return found;
}

function resolveDataMode(options) {
  const savedMode = options.savedMode || null;
  const candidates = options.candidates || [];
  if (options.forceDemo) return { mode: 'demo', source: 'forced', needsPicker: false };
  if (savedMode === 'cloud') return { mode: 'cloud', source: 'saved', needsPicker: false };
  if (savedMode === 'demo' && options.explicitDemo) return { mode: 'demo', source: 'explicit', needsPicker: false };
  if (options.rememberedFile) return { mode: 'local', source: 'remembered', file: options.rememberedFile, needsPicker: false };
  if (candidates.length === 1) return { mode: 'local', source: 'detected', file: candidates[0], needsPicker: false };
  if (candidates.length > 1) return { mode: 'local', source: 'ambiguous', needsPicker: true };
  if (savedMode === 'local') return { mode: 'local', source: 'missing', needsPicker: true };
  if (options.platform === 'darwin' && savedMode == null) return { mode: 'local', source: 'default', needsPicker: true };
  if (savedMode === 'demo') return { mode: 'demo', source: 'legacy-no-file', needsPicker: false };
  return { mode: 'signin', source: 'signin', needsPicker: false };
}

function assertRegularFile(file, lstat) {
  let stat;
  try { stat = lstat(file); }
  catch (err) {
    if (err && err.code === 'ENOENT') throw notFoundError();
    throw err;
  }
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw notFoundError();
  if (isDatalessStat(stat)) throw datalessError();
  return stat;
}

function listBackupNames(folder) {
  const backups = path.join(folder, 'Backups');
  let stat;
  try { stat = fs.lstatSync(backups); } catch (e) { return { dir: backups, names: null }; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { dir: backups, names: null };
  return { dir: backups, names: fs.readdirSync(backups) };
}

function writeBackup(folder, raw, now) {
  const listed = listBackupNames(folder);
  if (!listed.names) return { backedUp: false, reason: 'no-backups-folder' };
  const day = localDay(now());
  const name = inferBackupName(listed.names, day);
  if (listed.names.indexOf(name) >= 0) return { backedUp: false, reason: 'already-today', name: name };
  const dest = path.join(listed.dir, name);
  if (path.dirname(path.resolve(dest)) !== path.resolve(listed.dir)) throw new Error('Refusing backup path.');
  const tmp = path.join(listed.dir, '.backup-write-' + crypto.randomBytes(6).toString('hex') + '.tmp');
  fs.writeFileSync(tmp, raw, { flag: 'wx' });
  try {
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (e) { /* leave the save uncommitted */ }
    throw err;
  }
  return { backedUp: true, name: name };
}

function atomicReplace(file, bytes) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, '.checklist-write-' + crypto.randomBytes(6).toString('hex') + '.tmp');
  fs.writeFileSync(tmp, bytes, { flag: 'wx' });
  try {
    const again = fs.readFileSync(file);
    return { tmp: tmp, again: again };
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (e) { /* reported below */ }
    throw err;
  }
}

function createLocalStore(options) {
  const file = options.file;
  const now = options.now || function () { return new Date(); };
  const lstat = options.lstat || function (target) { return fs.lstatSync(target); };
  const readFile = options.readFile || function (target) { return fs.readFileSync(target); };
  if (path.basename(file) !== CHECKLIST_NAME) throw new Error('Refusing a file that is not checklist.json.');

  function readRaw() {
    assertRegularFile(file, lstat);
    return readFile(file);
  }

  function load() {
    let raw;
    try { raw = readRaw(); }
    catch (err) {
      if (err && (err.notFound || err.dataless)) throw err;
      if (err && err.code === 'ENOENT') throw notFoundError();
      throw err;
    }
    let data;
    try { data = JSON.parse(stripBom(raw).toString('utf8')); }
    catch (e) { throw new Error('The local checklist is not valid JSON. Nothing was changed.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The local checklist is not a document. Nothing was changed.');
    return { data: data, etag: hashBytes(raw) };
  }

  return {
    file: file,
    load: load,
    etag: function () {
      try { return hashBytes(readRaw()); }
      catch (err) {
        if (err && err.code === 'ENOENT') throw notFoundError();
        throw err;
      }
    },
    save: function (data, expectedEtag) {
      if (typeof expectedEtag !== 'string' || !expectedEtag) throw new Error('Refusing to save without the loaded file version.');
      let current;
      try { current = readRaw(); }
      catch (err) {
        if (err && err.code === 'ENOENT') throw notFoundError();
        throw err;
      }
      if (hashBytes(current) !== expectedEtag) return { conflict: true };
      const next = serializeChecklist(data);
      const pending = atomicReplace(file, next);
      try {
        if (hashBytes(pending.again) !== expectedEtag) {
          try { fs.unlinkSync(pending.tmp); } catch (e) { /* temp is ours */ }
          return { conflict: true };
        }
        const backup = writeBackup(path.dirname(file), pending.again, now);
        fs.renameSync(pending.tmp, file);
        return { etag: hashBytes(next), backup: backup };
      } catch (err) {
        try { fs.unlinkSync(pending.tmp); } catch (e) { /* already gone */ }
        throw err;
      }
    }
  };
}

module.exports = {
  SF_DATALESS,
  DATALESS_MESSAGE,
  CHECKLIST_NAME,
  FOLDER_NAME,
  isDatalessStat,
  stripBom,
  hashBytes,
  serializeChecklist,
  localDay,
  inferBackupName,
  checklistFileIn,
  findCandidateFiles,
  resolveDataMode,
  createLocalStore
};
