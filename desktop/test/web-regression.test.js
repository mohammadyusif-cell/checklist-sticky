'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const merge = fs.readFileSync(path.join(root, 'merge.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const sample = JSON.parse(fs.readFileSync(path.join(root, 'sample-checklist.json'), 'utf8'));

function stop(dom) {
  const window = dom.window;
  const probe = window.setInterval(function () {}, 100000);
  for (let i = 0; i <= probe; i++) window.clearInterval(i);
  window.close();
}

function boot(options) {
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', function (error) { errors.push(error); });
  const dom = new JSDOM(html, {
    url: options.url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: virtualConsole
  });
  const window = dom.window;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: options.width || 1100 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: options.height || 800 });
  window.confirm = function () { return true; };
  window.alert = function () {};
  window.scrollTo = function () {};
  if (!window.crypto || !window.crypto.getRandomValues) {
    Object.defineProperty(window, 'crypto', { value: require('node:crypto').webcrypto });
  }
  const fetches = [];
  window.fetch = async function (url) {
    const target = String(url);
    fetches.push(target);
    if (target.indexOf('sample-checklist.json') >= 0) {
      return {
        ok: true,
        status: 200,
        json: async function () { return JSON.parse(JSON.stringify(sample)); },
        text: async function () { return JSON.stringify(sample); }
      };
    }
    throw new Error('blocked fetch ' + target);
  };
  if (options.desktop) window.checklistDesktop = options.desktop;
  window.eval(config);
  window.eval(merge);
  window.eval(app);
  window.__fetches = fetches;
  window.__errors = errors;
  return dom;
}

async function waitFor(fn) {
  const start = Date.now();
  let last;
  while (Date.now() - start < 2000) {
    try {
      const value = fn();
      if (value) return value;
    } catch (error) { last = error; }
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
  }
  throw last || new Error('timed out waiting for the checklist');
}

function columns(document) {
  return [...document.querySelectorAll('#cols > .col')].map(function (col) {
    return [...col.querySelectorAll(':scope > section')].map(function (card) {
      return [...card.classList].find(function (name) { return name !== 'card' && name !== 'collapsed'; });
    });
  });
}

function counts(text) {
  const match = String(text || '').match(/(\d+) done\s·\s(\d+) due/);
  return match ? { done: Number(match[1]), due: Number(match[2]) } : null;
}

test('index.html keeps the website script order', () => {
  const configAt = html.indexOf('src="config.js"');
  const msalAt = html.indexOf('src="vendor/msal-browser-3.30.0.min.js"');
  const mergeAt = html.indexOf('src="merge.js"');
  const appAt = html.indexOf('src="app.js"');
  assert.ok(configAt > 0 && configAt < msalAt && msalAt < mergeAt && mergeAt < appAt);
  assert.equal(html.includes('id="btnSample"'), false);
  assert.equal(html.includes('id="btnPin"'), false);
});

test('sample checklist at a normal window is two columns with tasks left and payroll and bills right', async () => {
  const dom = boot({ url: 'http://127.0.0.1/checklist/?demo', width: 1100 });
  try {
    await waitFor(function () { return dom.window.document.querySelector('#cols.c2 .card.tasks'); });
    const cols = columns(dom.window.document);
    assert.equal(cols.length, 2);
    assert.equal(cols[0][0], 'tasks');
    assert.equal(cols[1].includes('payroll'), true);
    assert.equal(cols[1].includes('bills'), true);
    assert.equal(cols[0].includes('payroll'), false);
    assert.equal(cols[0].includes('bills'), false);
    const tally = counts(dom.window.document.getElementById('tally').textContent);
    assert.equal(dom.window.document.getElementById('tally').textContent, '12 total · 2 done · 10 due');
    assert.equal(tally.due, 12 - tally.done);
    dom.window.document.querySelectorAll('#cols .card').forEach(function (card) {
      const total = Number((card.querySelector('.n').textContent.match(/\d+/) || [])[0]);
      const count = counts(card.querySelector('.count') && card.querySelector('.count').textContent);
      if (!total) {
        assert.equal(count, null);
        return;
      }
      assert.equal(count.done + count.due, total);
    });
    assert.equal(dom.window.document.getElementById('btnSample'), null);
    assert.equal(dom.window.document.getElementById('btnPin'), null);
    assert.equal(dom.window.__fetches.some(function (url) { return url.indexOf('graph.microsoft.com') >= 0; }), false);
  } finally { stop(dom); }
});

test('done tasks move to the bottom and due stays total minus done', async () => {
  const dom = boot({ url: 'http://127.0.0.1/checklist/?demo', width: 1100 });
  try {
    await waitFor(function () { return dom.window.document.querySelector('.card.tasks .cb'); });
    const document = dom.window.document;
    const before = [...document.querySelectorAll('.card.tasks .text')].map(function (node) { return node.textContent; });
    assert.equal(before[before.length - 1], 'File the annual report');
    document.querySelector('.card.tasks .cb').click();
    const after = [...document.querySelectorAll('.card.tasks .text')].map(function (node) { return node.textContent; });
    assert.deepEqual(after.slice(-2), ['Call the bank about the deposit', 'File the annual report']);
    assert.equal(document.getElementById('tally').textContent, '12 total · 3 done · 9 due');
    const payroll = [...document.querySelectorAll('.card.payroll .row')];
    assert.equal(payroll[payroll.length - 1].classList.contains('done'), true);
    assert.equal(payroll.slice(0, -1).every(function (row) { return !row.classList.contains('done'); }), true);
  } finally { stop(dom); }
});

test('lists collapse and move, and a wide window uses four columns', async () => {
  const dom = boot({ url: 'http://127.0.0.1/checklist/?demo', width: 1100 });
  try {
    await waitFor(function () { return dom.window.document.querySelector('.card.tasks'); });
    const document = dom.window.document;
    document.querySelector('.card.tasks .card-h').click();
    assert.equal(document.querySelector('.card.tasks').classList.contains('collapsed'), true);
    assert.equal(JSON.parse(document.defaultView.localStorage.getItem('cs.collapsed')).tasks, true);
    document.getElementById('btnReorder').click();
    document.querySelector('.card.bookkeeping .lmv button').click();
    assert.equal(columns(document)[0][0], 'bookkeeping');
    const order = JSON.parse(document.defaultView.localStorage.getItem('cs.listOrder'));
    assert.equal(order.includes('tasks') && order.includes('payroll') && order.includes('bills'), true);
    document.getElementById('btnResetOrder').click();
    assert.equal(columns(document)[0][0], 'tasks');

    document.defaultView.innerWidth = 1700;
    document.defaultView.dispatchEvent(new document.defaultView.Event('resize'));
    const wide = columns(document);
    assert.equal(document.getElementById('cols').className.includes('c4'), true);
    assert.equal(wide[0].includes('tasks'), true);
    assert.deepEqual(wide[1], ['payroll']);
    assert.equal(wide[2][0], 'bills');
    assert.equal(wide[3].includes('bookkeeping'), true);

    document.defaultView.innerWidth = 1100;
    document.documentElement.setAttribute('data-cols', '4');
    document.documentElement.setAttribute('data-text', 'large');
    document.defaultView.dispatchEvent(new document.defaultView.Event('resize'));
    assert.equal(columns(document).length, 4);
    assert.equal(document.getElementById('cols').className.includes('c4'), true);
  } finally { stop(dom); }
});

test('desktop sign-in screen does not call Graph until the user signs in', async () => {
  let signedIn = false;
  let sample = false;
  const desktop = {
    getBoot: async function () { return { demo: false, signedIn: false, alwaysOnTop: false, account: '', vibrancy: false }; },
    accountName: function () { return ''; },
    signedIn: async function () { return signedIn; },
    signIn: async function () { return { error: 'Sign-in was cancelled. Nothing was changed on OneDrive.' }; },
    signOut: async function () { return { ok: true }; },
    useSample: async function () { sample = true; return { ok: true }; },
    load: async function () { throw new Error('load must not run'); },
    save: async function () { throw new Error('save must not run'); },
    etag: async function () { throw new Error('etag must not run'); },
    setAlwaysOnTop: async function (on) { return on; }
  };
  const dom = boot({ url: 'http://127.0.0.1/checklist/?demo', width: 1100, desktop: desktop });
  try {
    await waitFor(function () { return !dom.window.document.getElementById('signin').classList.contains('hidden'); });
    const document = dom.window.document;
    assert.ok(document.getElementById('signinNote'));
    assert.equal(document.getElementById('cols').children.length, 0);
    assert.equal(dom.window.__fetches.length, 0);
    document.getElementById('btnSignIn').click();
    await waitFor(function () { return document.getElementById('status').textContent.indexOf('Nothing was changed on OneDrive') >= 0; });
    assert.equal(sample, false);
    document.getElementById('btnSample').click();
    await waitFor(function () { return sample; });
    document.getElementById('btnPin').click();
    await waitFor(function () { return document.getElementById('btnPin').classList.contains('on'); });
  } finally { stop(dom); }
});

test('without a sign-in library the website does not invent a network store', async () => {
  const dom = boot({ url: 'http://127.0.0.1/checklist/', width: 1100 });
  try {
    await waitFor(function () { return dom.window.document.getElementById('status').textContent.indexOf('Sign-in library failed') >= 0; });
    assert.equal(dom.window.__fetches.length, 0);
    assert.equal(dom.window.document.querySelector('#cols .card'), null);
  } finally { stop(dom); }
});
