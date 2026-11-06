'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auth = require('./auth');
const graph = require('./graph');
const preferences = require('./preferences');
const tokenStoreMod = require('./token-store');
const webroot = require('./webroot');

const smoke = process.argv.includes('--smoke') || process.env.CHECKLIST_SMOKE === '1';
const forceDemo = smoke || process.argv.includes('--demo') || process.env.CHECKLIST_FORCE_DEMO === '1';

app.setName('Checklist Sticky');
if (smoke) {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-sticky-smoke-')));
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'checklist',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true }
}]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.exit(0);

let win = null;
let quitting = false;
let signInFlight = null;
const remoteHosts = [];
const webRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.join(__dirname, '..', '..');
const modeFile = () => path.join(app.getPath('userData'), 'checklist-mode.json');
const windowFile = () => path.join(app.getPath('userData'), 'window-state.json');
const tokenFile = () => path.join(app.getPath('userData'), 'microsoft-session.bin');

function webConfig() {
  return auth.readWebConfig(fs.readFileSync(path.join(webRoot, 'config.js'), 'utf8'));
}

let memoryTokens = null;
let persistentTokens = null;
let encryptionKnown = null;

function encryptionAvailable() {
  if (!encryptionKnown) {
    encryptionKnown = safeStorage.isAsyncEncryptionAvailable().catch(function () { return false; });
  }
  return encryptionKnown;
}

async function getTokenStore() {
  if (await encryptionAvailable()) {
    if (!persistentTokens) {
      persistentTokens = tokenStoreMod.createEncryptedTokenStore({
        file: tokenFile(),
        encrypt: function (text) { return safeStorage.encryptStringAsync(text); },
        decrypt: async function (buffer) {
          const decoded = await safeStorage.decryptStringAsync(buffer);
          return decoded && typeof decoded === 'object' && decoded.result != null ? decoded.result : decoded;
        }
      });
    }
    return persistentTokens;
  }
  if (!memoryTokens) memoryTokens = tokenStoreMod.createMemoryTokenStore();
  return memoryTokens;
}

function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'checklist:' && parsed.hostname === 'app';
  } catch (e) {
    return false;
  }
}

function ipcError(err) {
  if (err && err.notFound) return { error: 'notFound' };
  if (err && (err.code === 'signin' || err.signin)) return { error: 'signin' };
  if (err && err.conflict) return { conflict: true };
  const message = err && err.message ? String(err.message) : 'Something went wrong.';
  return { error: message.slice(0, 400) };
}

async function currentAccount() {
  try {
    const tokens = await (await getTokenStore()).read();
    return tokens && tokens.account ? tokens.account : '';
  } catch (e) {
    return '';
  }
}

async function isSignedIn() {
  try {
    const tokens = await (await getTokenStore()).read();
    return !!(tokens && (tokens.accessToken || tokens.refreshToken));
  } catch (e) {
    return false;
  }
}

async function bootInfo() {
  const mode = preferences.readMode(modeFile());
  const windowState = preferences.readWindowState(windowFile());
  const signedIn = await isSignedIn();
  return {
    demo: forceDemo || mode === 'demo',
    signedIn: signedIn,
    account: signedIn ? await currentAccount() : '',
    alwaysOnTop: windowState.alwaysOnTop === true,
    vibrancy: process.platform === 'darwin',
    platform: process.platform,
    tokenStorage: (await encryptionAvailable()) ? 'keychain' : 'memory'
  };
}

async function accessToken() {
  const cfg = webConfig();
  const store = await getTokenStore();
  const tokens = await store.read();
  if (!tokens || (!tokens.accessToken && !tokens.refreshToken)) {
    const err = new Error('signin');
    err.code = 'signin';
    throw err;
  }
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
  if (!tokens.refreshToken) {
    const err = new Error('signin');
    err.code = 'signin';
    throw err;
  }
  try {
    const next = await auth.refreshTokens(fetch, {
      authority: cfg.authority,
      clientId: cfg.clientId,
      refreshToken: tokens.refreshToken,
      previous: tokens
    });
    await store.write(next);
    return next.accessToken;
  } catch (err) {
    if (err && err.clearSession) await store.clear();
    throw err;
  }
}

async function performSignIn() {
  if (smoke || process.env.CHECKLIST_FORCE_DEMO === '1') {
    throw Object.assign(new Error('This run is sample-only and will not contact Microsoft.'), { code: 'sample-only' });
  }
  if (signInFlight) return signInFlight;
  const cfg = webConfig();
  signInFlight = auth.startLoopbackLogin({
    clientId: cfg.clientId,
    authority: cfg.authority,
    scopes: cfg.scopes,
    fetchFn: fetch,
    openBrowser: async function (url) {
      const safe = auth.assertMicrosoftAuthorizeUrl(url);
      await shell.openExternal(safe);
    }
  }).then(async function (tokens) {
    await (await getTokenStore()).write(tokens);
    preferences.writeMode(modeFile(), 'cloud');
    return { ok: true };
  }).finally(function () { signInFlight = null; });
  return signInFlight;
}

function sendLayout() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('checklist:layout', win.isFullScreen() ? 'full' : 'window');
}

function saveWindowState() {
  if (!win || win.isDestroyed() || smoke) return;
  const bounds = win.getBounds();
  preferences.writeWindowState(windowFile(), {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    alwaysOnTop: win.isAlwaysOnTop(),
    isFullScreen: win.isFullScreen()
  });
}

function refreshMenu() {
  if (!win || win.isDestroyed()) return;
  const mode = preferences.readMode(modeFile());
  const demo = forceDemo || mode === 'demo';
  isSignedIn().then(function (signedIn) {
    if (!win || win.isDestroyed()) return;
    const onTop = win.isAlwaysOnTop();
    const accountMenu = {
      label: 'Checklist Sticky',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Sign in to OneDrive…', enabled: !smoke, click: function () { menuSignIn(); } },
        { label: 'Use Sample Checklist', click: function () { menuSample(); } },
        { label: 'Sign Out', enabled: signedIn && !demo && !smoke, click: function () { menuSignOut(); } }
      ]
    };
    if (process.platform === 'darwin') {
      accountMenu.submenu.push(
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      );
    } else {
      accountMenu.submenu.push({ type: 'separator' }, { role: 'quit' });
    }
    const template = [
      accountMenu,
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Keep Window on Top',
            type: 'checkbox',
            checked: onTop,
            click: function (item) { setOnTop(item.checked); }
          },
          { type: 'separator' },
          { role: 'reload' },
          { type: 'separator' },
          { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'minimize' },
          { role: 'close' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }).catch(function () {});
}

function setOnTop(on) {
  if (!win || win.isDestroyed()) return;
  if (on) win.setAlwaysOnTop(true, 'floating');
  else win.setAlwaysOnTop(false);
  saveWindowState();
  win.webContents.send('checklist:pin', win.isAlwaysOnTop());
  refreshMenu();
}

function menuSignIn() {
  performSignIn().then(function () {
    if (win && !win.isDestroyed()) win.webContents.reload();
    refreshMenu();
  }).catch(function (err) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Checklist Sticky',
      message: 'Sign-in did not finish',
      detail: (err && err.message ? err.message : 'Nothing was changed on OneDrive.').slice(0, 500)
    });
  });
}

function menuSample() {
  preferences.writeMode(modeFile(), 'demo');
  if (win && !win.isDestroyed()) win.webContents.reload();
  refreshMenu();
}

function menuSignOut() {
  getTokenStore().then(function (store) { return store.clear(); }).then(function () {
    preferences.writeMode(modeFile(), null);
    if (win && !win.isDestroyed()) win.webContents.reload();
    refreshMenu();
  }).catch(function () {});
}

function lockContents(contents) {
  contents.setWindowOpenHandler(function () { return { action: 'deny' }; });
  contents.on('will-navigate', function (event, url) {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', function (event, url) {
    if (!isAppUrl(url)) event.preventDefault();
  });
}

function createWindow() {
  const saved = preferences.readWindowState(windowFile());
  const restoring = fs.existsSync(windowFile());
  const mac = process.platform === 'darwin';
  const options = {
    width: saved.width,
    height: saved.height,
    minWidth: 480,
    minHeight: 480,
    show: false,
    title: 'Checklist Sticky',
    backgroundColor: mac ? '#00000000' : '#16181e',
    fullscreenable: true,
    minimizable: true,
    maximizable: true,
    resizable: true,
    closable: true,
    skipTaskbar: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false
    }
  };
  if (saved.x != null) options.x = saved.x;
  if (saved.y != null) options.y = saved.y;
  if (mac) {
    options.transparent = true;
    options.vibrancy = 'under-window';
    options.visualEffectState = 'active';
    options.titleBarStyle = 'hiddenInset';
    options.trafficLightPosition = { x: 14, y: 16 };
  }
  win = new BrowserWindow(options);
  if (!restoring) win.setContentSize(1180, 800);
  if (saved.alwaysOnTop && !smoke) win.setAlwaysOnTop(true, 'floating');
  lockContents(win.webContents);
  win.once('ready-to-show', function () { win.show(); });
  win.webContents.on('did-finish-load', function () {
    sendLayout();
    refreshMenu();
    if (smoke) runSmoke();
  });
  win.on('enter-full-screen', sendLayout);
  win.on('leave-full-screen', sendLayout);
  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  win.on('close', function (event) {
    saveWindowState();
    if (smoke || quitting || win.__flushed) return;
    event.preventDefault();
    const script = 'window.__csFlush ? window.__csFlush() : Promise.resolve()';
    Promise.race([
      win.webContents.executeJavaScript(script, true).catch(function () {}),
      new Promise(function (resolve) { setTimeout(resolve, 8000); })
    ]).finally(function () {
      win.__flushed = true;
      win.close();
    });
  });
  // ?demo is a fail-safe: if the preload bridge is missing, the page stays on
  // the local sample and cannot fall through to an in-window Microsoft login.
  win.loadURL('checklist://app/index.html?demo');
  if (saved.isFullScreen && !smoke) win.setFullScreen(true);
}

function smokeResultPath() {
  return process.env.CHECKLIST_SMOKE_RESULT || path.join(app.getPath('userData'), 'smoke-result.json');
}

function writeSmoke(result) {
  try {
    fs.writeFileSync(smokeResultPath(), JSON.stringify(result, null, 2));
  } catch (e) { /* the process exit code is the other signal */ }
}

function runSmoke() {
  const started = Date.now();
  const timer = setInterval(function () {
    if (!win || win.isDestroyed()) return;
    win.webContents.executeJavaScript(`(() => {
      const cols = [...document.querySelectorAll('#cols > .col')];
      const tally = (document.getElementById('tally') || {}).textContent || '';
      const names = cols.map(col => [...col.querySelectorAll(':scope > section')].map(card => (card.className || '').split(/\\s+/).find(c => c && c !== 'card' && c !== 'collapsed') || ''));
      const total = (tally.match(/(\\d+) total/) || [])[1];
      const done = (tally.match(/(\\d+) done/) || [])[1];
      const due = (tally.match(/(\\d+) due/) || [])[1];
      return {
        colClass: (document.getElementById('cols') || {}).className || '',
        names,
        tally,
        mathOk: total != null && done != null && due != null && Number(due) === Number(total) - Number(done),
        desktop: document.documentElement.dataset.desktop || '',
        signinHidden: !!(document.getElementById('signin') && document.getElementById('signin').classList.contains('hidden')),
        hasPin: !!document.getElementById('btnPin'),
        cardCount: document.querySelectorAll('#cols section.card').length
      };
    })()`, true).then(function (info) {
      if (!info || !info.cardCount) {
        if (Date.now() - started > 15000) failSmoke('checklist did not render');
        return;
      }
      const hosts = remoteHosts.filter(function (host) {
        return host === 'graph.microsoft.com' || host === 'login.microsoftonline.com';
      });
      const left = (info.names[0] || []);
      const right = (info.names[1] || []);
      const ok = info.colClass.indexOf('c2') >= 0
        && left.indexOf('tasks') >= 0
        && right.indexOf('payroll') >= 0
        && right.indexOf('bills') >= 0
        && info.mathOk
        && info.desktop === '1'
        && info.signinHidden
        && info.hasPin
        && hosts.length === 0;
      const result = {
        ok: ok,
        info: info,
        blockedMicrosoftHosts: hosts,
        remoteHostCount: remoteHosts.length,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron
      };
      writeSmoke(result);
      clearInterval(timer);
      app.exit(ok ? 0 : 1);
    }).catch(function (err) {
      if (Date.now() - started > 15000) failSmoke(err && err.message);
    });
  }, 250);
  function failSmoke(message) {
    clearInterval(timer);
    writeSmoke({ ok: false, error: String(message || 'smoke failed').slice(0, 300), platform: process.platform, arch: process.arch });
    app.exit(1);
  }
}

function flushThenQuit() {
  if (!win || win.isDestroyed()) {
    quitting = true;
    app.quit();
    return;
  }
  const script = 'window.__csFlush ? window.__csFlush() : Promise.resolve()';
  Promise.race([
    win.webContents.executeJavaScript(script, true).catch(function () {}),
    new Promise(function (resolve) { setTimeout(resolve, 8000); })
  ]).finally(function () {
    quitting = true;
    app.quit();
  });
}

app.on('second-instance', function () {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (!win || win.isDestroyed()) createWindow();
  else win.show();
});

app.on('before-quit', function (event) {
  if (quitting || smoke) return;
  event.preventDefault();
  flushThenQuit();
});

app.whenReady().then(function () {
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular');
    if (app.dock) app.dock.show();
  }
  app.setAboutPanelOptions({
    applicationName: 'Checklist Sticky',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Not notarized. OneDrive sign-in uses the system browser.'
  });
  protocol.handle('checklist', function (request) {
    let url;
    try { url = new URL(request.url); } catch (e) { return new Response('Bad request', { status: 400 }); }
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const file = webroot.resolveWebFile(webRoot, url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
    const body = fs.readFileSync(file);
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'Content-Type': webroot.contentType(file),
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store'
      }
    });
  });

  session.defaultSession.setPermissionRequestHandler(function (_contents, _permission, callback) { callback(false); });
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, function (details, callback) {
    try { remoteHosts.push(new URL(details.url).host); } catch (e) { remoteHosts.push(''); }
    if (smoke) callback({ cancel: true });
    else callback({});
  });

  ipcMain.handle('checklist:boot', function () { return bootInfo(); });
  ipcMain.handle('checklist:signed-in', function () { return isSignedIn(); });
  ipcMain.handle('checklist:sign-in', function () {
    return performSignIn().then(function () { return { ok: true }; }, function (err) { return ipcError(err); });
  });
  ipcMain.handle('checklist:sign-out', function () {
    return getTokenStore().then(function (store) { return store.clear(); }).then(function () {
      preferences.writeMode(modeFile(), null);
      return { ok: true };
    });
  });
  ipcMain.handle('checklist:use-sample', function () {
    preferences.writeMode(modeFile(), 'demo');
    return { ok: true };
  });
  ipcMain.handle('checklist:load', async function () {
    try {
      const cfg = webConfig();
      const token = await accessToken();
      return await graph.loadChecklist(fetch, token, cfg.dataPath);
    } catch (err) { return ipcError(err); }
  });
  ipcMain.handle('checklist:etag', async function () {
    try {
      const cfg = webConfig();
      const token = await accessToken();
      return { etag: await graph.readEtag(fetch, token, cfg.dataPath) };
    } catch (err) { return ipcError(err); }
  });
  ipcMain.handle('checklist:save', async function (_event, data, etag) {
    try {
      const cfg = webConfig();
      const token = await accessToken();
      return await graph.saveChecklist(fetch, token, cfg.dataPath, data, etag);
    } catch (err) { return ipcError(err); }
  });
  ipcMain.handle('checklist:always-on-top', function (_event, on) {
    setOnTop(!!on);
    return win && win.isAlwaysOnTop();
  });

  createWindow();
  refreshMenu();
}).catch(function (err) {
  if (smoke) {
    writeSmoke({ ok: false, error: String(err && err.message || err).slice(0, 300) });
    app.exit(1);
  } else {
    dialog.showErrorBox('Checklist Sticky', 'The app could not open a window.');
    app.exit(1);
  }
});
