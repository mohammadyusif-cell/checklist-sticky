'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const localFile = require('../src/local-file');
const { merge } = require('../../merge.js');

function fixtureHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-home-'));
  const personal = path.join(home, 'Library', 'CloudStorage', 'OneDrive-Personal', 'Checklist Sticky');
  const business = path.join(home, 'Library', 'CloudStorage', 'OneDrive-Business', 'Checklist Sticky');
  fs.mkdirSync(personal, { recursive: true });
  fs.mkdirSync(business, { recursive: true });
  fs.mkdirSync(path.join(home, 'Library', 'CloudStorage', 'Dropbox', 'Checklist Sticky'), { recursive: true });
  return { home: home, personal: personal, business: business };
}

function writeChecklist(folder, data, bom) {
  const body = JSON.stringify(data, null, 2);
  const buf = Buffer.from((bom ? '\uFEFF' : '') + body, 'utf8');
  fs.writeFileSync(path.join(folder, 'checklist.json'), buf);
}

const sample = {
  weekStart: '2026-11-02',
  payrollManualOrder: true,
  office: 'sample',
  tasks: [{ id: 't1', day: '2026-11-02', text: 'Call the bank', notes: '', done: false }],
  payroll: [{ id: 'p1', day: '2026-11-06', text: 'Sample Restaurant LLC', notes: '', done: false }]
};

test('detects only OneDrive Checklist Sticky files and does not read them', () => {
  const dirs = fixtureHome();
  writeChecklist(dirs.personal, sample);
  fs.writeFileSync(path.join(dirs.home, 'Library', 'CloudStorage', 'Dropbox', 'Checklist Sticky', 'checklist.json'), '{}');
  let reads = 0;
  const found = localFile.findCandidateFiles(dirs.home, {
    readdir: function (dir) { return fs.readdirSync(dir); },
    lstat: function (file) {
      reads++;
      return fs.lstatSync(file);
    }
  });
  assert.deepEqual(found, [path.join(dirs.personal, 'checklist.json')]);
  assert.equal(reads, 2);
  assert.equal(fs.readFileSync(found[0], 'utf8').includes('Sample Restaurant'), true);
});

test('mode selection: legacy demo becomes local only when one file is found', () => {
  const one = ['/cloud/OneDrive-Personal/Checklist Sticky/checklist.json'];
  assert.equal(localFile.resolveDataMode({
    platform: 'darwin', forceDemo: false, savedMode: 'demo', explicitDemo: false, candidates: one
  }).mode, 'local');
  assert.equal(localFile.resolveDataMode({
    platform: 'darwin', forceDemo: false, savedMode: 'demo', explicitDemo: true, candidates: one
  }).mode, 'demo');
  assert.equal(localFile.resolveDataMode({
    platform: 'darwin', forceDemo: true, savedMode: null, explicitDemo: false, candidates: one
  }).mode, 'demo');
  assert.equal(localFile.resolveDataMode({
    platform: 'darwin', forceDemo: false, savedMode: 'cloud', explicitDemo: false, candidates: one
  }).mode, 'cloud');
  const none = localFile.resolveDataMode({
    platform: 'darwin', forceDemo: false, savedMode: 'demo', explicitDemo: false, candidates: []
  });
  assert.equal(none.mode, 'demo');
  assert.equal(none.needsPicker, false);
  const many = localFile.resolveDataMode({
    platform: 'darwin', forceDemo: false, savedMode: 'demo', explicitDemo: false,
    candidates: ['/a/checklist.json', '/b/checklist.json']
  });
  assert.equal(many.needsPicker, true);
  assert.equal(many.mode, 'local');
  const remembered = localFile.resolveDataMode({
    platform: 'darwin', forceDemo: false, savedMode: 'demo', explicitDemo: false,
    candidates: ['/a/checklist.json', '/b/checklist.json'], rememberedFile: '/chosen/checklist.json'
  });
  assert.equal(remembered.file, '/chosen/checklist.json');
  assert.equal(remembered.needsPicker, false);
  const freshMac = localFile.resolveDataMode({ platform: 'darwin', forceDemo: false, savedMode: null, candidates: [] });
  assert.equal(freshMac.needsPicker, true);
  const freshLinux = localFile.resolveDataMode({ platform: 'linux', forceDemo: false, savedMode: null, candidates: [] });
  assert.equal(freshLinux.mode, 'signin');
});

test('two OneDrive folders need a picker; one does not', () => {
  const dirs = fixtureHome();
  writeChecklist(dirs.personal, sample);
  writeChecklist(dirs.business, sample);
  const both = localFile.findCandidateFiles(dirs.home, {
    readdir: (dir) => fs.readdirSync(dir),
    lstat: (file) => fs.lstatSync(file)
  });
  assert.equal(both.length, 2);
  assert.equal(localFile.resolveDataMode({ platform: 'darwin', savedMode: null, candidates: both }).needsPicker, true);
  fs.unlinkSync(path.join(dirs.business, 'checklist.json'));
  const one = localFile.findCandidateFiles(dirs.home, {
    readdir: (dir) => fs.readdirSync(dir),
    lstat: (file) => fs.lstatSync(file)
  });
  const decision = localFile.resolveDataMode({ platform: 'darwin', savedMode: 'demo', explicitDemo: false, candidates: one });
  assert.equal(decision.mode, 'local');
  assert.equal(decision.file, path.join(dirs.personal, 'checklist.json'));
});

test('atomic save keeps every field, writes UTF-8 without a BOM, and leaves other files alone', () => {
  const dirs = fixtureHome();
  fs.writeFileSync(path.join(dirs.personal, 'notes.txt'), 'keep');
  writeChecklist(dirs.personal, sample, true);
  const store = localFile.createLocalStore({ file: path.join(dirs.personal, 'checklist.json'), now: function () { return new Date('2026-11-22T15:00:00'); } });
  const loaded = store.load();
  assert.equal(loaded.data.payrollManualOrder, true);
  assert.equal(loaded.data.office, 'sample');
  assert.equal(loaded.data.tasks[0].text, 'Call the bank');
  loaded.data.tasks[0].done = true;
  const saved = store.save(loaded.data, loaded.etag);
  assert.equal(saved.conflict, undefined);
  const raw = fs.readFileSync(path.join(dirs.personal, 'checklist.json'));
  assert.equal(raw[0], 0x7B);
  assert.notEqual(raw[0], 0xEF);
  const again = JSON.parse(raw.toString('utf8'));
  assert.equal(again.payrollManualOrder, true);
  assert.equal(again.office, 'sample');
  assert.equal(again.tasks[0].done, true);
  assert.equal(again.payroll[0].text, 'Sample Restaurant LLC');
  assert.equal(fs.readFileSync(path.join(dirs.personal, 'notes.txt'), 'utf8'), 'keep');
  assert.equal(fs.readdirSync(dirs.personal).filter(function (name) { return name.indexOf('.checklist-write-') === 0; }).length, 0);
  assert.equal(saved.backup.reason, 'no-backups-folder');
});

test('the first write of a day copies the previous bytes into Backups and the second does not', () => {
  const dirs = fixtureHome();
  const backups = path.join(dirs.personal, 'Backups');
  fs.mkdirSync(backups);
  fs.writeFileSync(path.join(backups, 'checklist_2026-11-01.json'), '{"older":true}');
  writeChecklist(dirs.personal, sample);
  const original = fs.readFileSync(path.join(dirs.personal, 'checklist.json'));
  const now = function () { return new Date('2026-11-22T09:00:00'); };
  const store = localFile.createLocalStore({ file: path.join(dirs.personal, 'checklist.json'), now: now });
  const loaded = store.load();
  loaded.data.tasks.push({ id: 't9', day: '2026-11-22', text: 'New sample task', notes: '', done: false });
  const first = store.save(loaded.data, loaded.etag);
  assert.equal(first.backup.backedUp, true);
  assert.equal(first.backup.name, 'checklist_2026-11-22.json');
  const backup = fs.readFileSync(path.join(backups, 'checklist_2026-11-22.json'));
  assert.equal(Buffer.compare(backup, original), 0);
  const second = store.save(JSON.parse(fs.readFileSync(path.join(dirs.personal, 'checklist.json'), 'utf8')), first.etag);
  assert.equal(second.backup.reason, 'already-today');
  assert.equal(fs.readdirSync(backups).filter(function (name) { return name.indexOf('2026-11-22') >= 0; }).length, 1);
  assert.equal(fs.readdirSync(backups).some(function (name) { return name.indexOf('.tmp') >= 0; }), false);
});

test('an empty Backups folder uses checklist-YYYY-MM-DD.json', () => {
  assert.equal(localFile.inferBackupName([], '2026-11-22'), 'checklist-2026-11-22.json');
  assert.equal(localFile.inferBackupName(['2026-11-01.json', '2026-11-02.json'], '2026-11-22'), '2026-11-22.json');
  assert.equal(localFile.inferBackupName(['checklist.json.2026-11-01'], '2026-11-22'), 'checklist.json.2026-11-22');
});

test('a newer file on disk is merged and not overwritten blindly', () => {
  const dirs = fixtureHome();
  fs.mkdirSync(path.join(dirs.personal, 'Backups'));
  writeChecklist(dirs.personal, sample);
  const store = localFile.createLocalStore({
    file: path.join(dirs.personal, 'checklist.json'),
    now: function () { return new Date('2026-11-22T12:00:00'); }
  });
  const loaded = store.load();
  const disk = JSON.parse(JSON.stringify(loaded.data));
  disk.tasks[0].done = true;
  fs.writeFileSync(path.join(dirs.personal, 'checklist.json'), JSON.stringify(disk, null, 2));
  const local = JSON.parse(JSON.stringify(loaded.data));
  local.tasks.push({ id: 't9', day: '2026-11-22', text: 'Added here', notes: '', done: false });
  const blocked = store.save(local, loaded.etag);
  assert.deepEqual(blocked, { conflict: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dirs.personal, 'checklist.json'), 'utf8')).tasks.length, 1);
  const remote = store.load();
  const merged = merge(loaded.data, local, remote.data).data;
  assert.equal(merged.tasks[0].done, true);
  assert.equal(merged.tasks.some(function (item) { return item.id === 't9'; }), true);
  assert.equal(merged.payrollManualOrder, true);
  const saved = store.save(merged, remote.etag);
  assert.equal(saved.conflict, undefined);
  const finalData = JSON.parse(fs.readFileSync(path.join(dirs.personal, 'checklist.json'), 'utf8'));
  assert.equal(finalData.tasks[0].done, true);
  assert.equal(finalData.tasks[1].text, 'Added here');
  assert.equal(finalData.office, 'sample');
});

test('a missing checklist is not created', () => {
  const dirs = fixtureHome();
  const file = path.join(dirs.personal, 'checklist.json');
  const store = localFile.createLocalStore({ file: file });
  assert.throws(() => store.load(), (err) => err.notFound === true);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(dirs.personal), []);
});

test('online-only placeholder stats are recognized and not read', () => {
  assert.equal(localFile.isDatalessStat({ size: 40, blocks: 0, flags: 0 }), true);
  assert.equal(localFile.isDatalessStat({ size: 40, blocks: 8, flags: localFile.SF_DATALESS }), true);
  assert.equal(localFile.isDatalessStat({ size: 40, blocks: 8, flags: 0 }), false);
  assert.equal(localFile.isDatalessStat({ size: 0, blocks: 0, flags: 0 }), false);
  let reads = 0;
  const store = localFile.createLocalStore({
    file: path.join('/tmp', 'checklist.json'),
    lstat: function () { return { isFile: function () { return true; }, isSymbolicLink: function () { return false; }, size: 20, blocks: 0 }; },
    readFile: function () { reads++; return Buffer.from('{}'); }
  });
  assert.throws(() => store.load(), (err) => err.dataless === true && err.message === localFile.DATALESS_MESSAGE);
  assert.equal(reads, 0);
});
