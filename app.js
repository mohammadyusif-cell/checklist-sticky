/* Checklist Sticky - web / iPhone version. Same checklist.json as the PC app (OneDrive), same lists and rules. */
(function () {
  'use strict';
  var CFG = window.CHECKLIST_CONFIG || {};
  var M = window.ChecklistMerge;
  var DEFS = [
    { key: 'tasks', title: 'Tasks', col2: 0, col4: 0, amount: false, hint: 'Add a task...', due: true },
    { key: 'bookkeeping', title: 'Bookkeeping', col2: 0, col4: 3, amount: false, hint: 'Add a bookkeeping item...', due: true },
    { key: 'individualTaxes', title: 'Individual Income Taxes', col2: 0, col4: 3, amount: false, hint: 'Add an individual return...', due: true },
    { key: 'companyTaxes', title: 'Company Taxes', col2: 0, col4: 3, amount: false, hint: 'Add a company return...', due: true },
    { key: 'clientsToCharge', title: 'Clients to Charge', col2: 0, col4: 2, amount: true, hint: 'Add a client to charge...', due: true },
    { key: 'needFeedbackToCharge', title: 'Need Customer Feedback to Charge', col2: 0, col4: 2, amount: true, hint: 'Add a client waiting on feedback...', due: true },
    { key: 'payroll', title: 'Payroll', col2: 1, col4: 1, amount: false, hint: 'Add a client payroll...', due: false, byDay: true, sortByDay: false },
    { key: 'immigration', title: 'Immigration', col2: 1, col4: 3, amount: false, hint: 'Add an immigration case...', due: true },
    { key: 'bills', title: 'Bills Due', col2: 1, col4: 2, amount: true, hint: 'Add a bill...', due: false, byDay: true, sortByDay: true },
    { key: 'personalTasks', title: 'Personal Tasks', col2: 1, col4: 0, amount: false, hint: 'Add a personal task...', due: true }
  ];
  // default top-to-bottom list order. It also gives the right order inside each column of the 2- and 4-column layouts.
  var DEFAULT_ORDER = ['tasks', 'payroll', 'bookkeeping', 'individualTaxes', 'companyTaxes', 'immigration', 'bills', 'clientsToCharge', 'needFeedbackToCharge', 'personalTasks'];
  var ORDER4 = [['tasks', 'personalTasks'], ['payroll'], ['bills', 'clientsToCharge', 'needFeedbackToCharge'], ['bookkeeping', 'individualTaxes', 'companyTaxes', 'immigration']];
  var ACC = { tasks: '#8B8CFF', payroll: '#2DD4D4', bookkeeping: '#F5B942', individualTaxes: '#B67CFF', companyTaxes: '#F472B6',
    immigration: '#5AB8FF', bills: '#FF9F43', personalTasks: '#9AA9BF', clientsToCharge: '#E8E04A', needFeedbackToCharge: '#FFA38A' };
  var PREFIX = { tasks: 't', payroll: 'p', bills: 'b', bookkeeping: 'k', individualTaxes: 'i', companyTaxes: 'c', immigration: 'm',
    personalTasks: 's', clientsToCharge: 'q', needFeedbackToCharge: 'f' };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, base: null, etag: null, dirty: false, saving: false, reorder: false,
    collapsed: readLS('cs.collapsed', {}), listOrder: null, listCols: { 2: readLS('cs.listCols2', {}), 4: readLS('cs.listCols4', {}) }, store: null, cols: 0 };
  state.listOrder = normalizeOrder(readLS('cs.listOrder', []));
  function readLS(k, dflt) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v === 'object' ? v : dflt; } catch (e) { return dflt; } }

  // ------------------------------------------------------------ list layout (per device: localStorage only, never checklist.json)
  // saved order -> known keys only, no repeats; lists missing from it go back in at their default spot
  function normalizeOrder(saved) {
    var out = [];
    (Array.isArray(saved) ? saved : []).forEach(function (k) { if (DEFAULT_ORDER.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k); });
    DEFAULT_ORDER.forEach(function (k, i) {
      if (out.indexOf(k) >= 0) return;
      var at = 0;   // after the nearest list that comes before it by default
      for (var j = i - 1; j >= 0; j--) { var p = out.indexOf(DEFAULT_ORDER[j]); if (p >= 0) { at = p + 1; break; } }
      out.splice(at, 0, k);
    });
    return out;
  }
  function saveLayout() {
    localStorage.setItem('cs.collapsed', JSON.stringify(state.collapsed));
    localStorage.setItem('cs.listOrder', JSON.stringify(state.listOrder));
    localStorage.setItem('cs.listCols2', JSON.stringify(state.listCols[2]));
    localStorage.setItem('cs.listCols4', JSON.stringify(state.listCols[4]));
  }
  function colCount() { var w = window.innerWidth; return w >= 1600 ? 4 : (w >= 900 ? 2 : 1); }
  function homeCol(key, n) {
    if (n === 1) return 0;
    var o = state.listCols[n][key];
    if (typeof o === 'number' && o >= 0 && o < n) return o;
    return n === 4 ? ORDER4.findIndex(function (g) { return g.indexOf(key) >= 0; }) : defOf(key).col2;
  }
  // lists in one column, top to bottom
  function columnLists(ci, n) { return state.listOrder.filter(function (k) { return homeCol(k, n) === ci; }); }
  function moveList(key, dir) {
    var n = colCount(), o = state.listOrder, peers = columnLists(homeCol(key, n), n), pos = peers.indexOf(key);
    if (dir === 'left' || dir === 'right') {
      var c = homeCol(key, n) + (dir === 'left' ? -1 : 1);
      if (n === 1 || c < 0 || c >= n) { setStatus('Already in the ' + (dir === 'left' ? 'first' : 'last') + ' column.'); return; }
      state.listCols[n][key] = c;
    } else {
      var target = dir === 'top' ? peers[0] : dir === 'up' ? peers[pos - 1] : peers[pos + 1];
      if (target == null || target === key) { setStatus(dir === 'down' ? 'Already at the bottom.' : 'Already at the top.'); return; }
      o.splice(o.indexOf(key), 1);
      var to = o.indexOf(target); if (dir === 'down') to += 1;
      o.splice(to, 0, key);
    }
    saveLayout(); render();
  }
  function setAllCollapsed(v) { DEFAULT_ORDER.forEach(function (k) { state.collapsed[k] = v; }); saveLayout(); render(); }
  function resetLayout() { state.listOrder = DEFAULT_ORDER.slice(); state.listCols = { 2: {}, 4: {} }; saveLayout(); render(); setStatus('List order reset.'); }

  // ------------------------------------------------------------ helpers
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function lighten(hex, t) { var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * t); g = Math.round(g + (255 - g) * t); b = Math.round(b + (255 - b) * t); return 'rgb(' + r + ',' + g + ',' + b + ')'; }
  function parseDay(s) { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function tagText(d) { return DAYS[d.getDay()] + ' ' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear(); }
  function money(v) { if (v === '' || v == null || isNaN(+v)) return ''; return '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function newId(key) { var a = new Uint8Array(4); crypto.getRandomValues(a); return (PREFIX[key] || 'x') + Array.from(a, function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function list(key) { var d = state.data; if (!Array.isArray(d[key])) d[key] = []; return d[key]; }
  function defOf(key) { for (var i = 0; i < DEFS.length; i++) if (DEFS[i].key === key) return DEFS[i]; }
  function setStatus(msg, cls) { $('status').textContent = msg || ''; var s = $('sync'); s.className = 'sync ' + (cls || ''); }

  // display order: not-done first (manual order), done last; bills by date (manual order within a date).
  // Payroll keeps a free manual order (its date pill still shows on the right).
  function displayOrder(key) {
    var def = defOf(key);
    return list(key).map(function (it, idx) { return { it: it, idx: idx, done: it.done ? 1 : 0, day: def.sortByDay ? (it.day || '') : '' }; })
      .sort(function (a, b) { return a.done - b.done || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || a.idx - b.idx; });
  }

  // ------------------------------------------------------------ storage: OneDrive (Microsoft Graph) or demo
  function GraphStore() {
    var pca = new msal.PublicClientApplication({
      auth: { clientId: CFG.clientId, authority: CFG.authority, redirectUri: location.origin + location.pathname },
      cache: { cacheLocation: 'localStorage' }
    });
    var ready = pca.initialize().then(function () { return pca.handleRedirectPromise(); }).then(function (r) {
      if (r && r.account) pca.setActiveAccount(r.account);
      else if (!pca.getActiveAccount() && pca.getAllAccounts().length) pca.setActiveAccount(pca.getAllAccounts()[0]);
    });
    var enc = encodeURI(CFG.dataPath).replace(/#/g, '%23');
    var base = 'https://graph.microsoft.com/v1.0/me/drive/root:/' + enc;
    function token() {
      return ready.then(function () {
        var acct = pca.getActiveAccount();
        if (!acct) throw { signin: true };
        return pca.acquireTokenSilent({ scopes: CFG.scopes, account: acct }).then(function (r) { return r.accessToken; })
          .catch(function (e) {
            if (e instanceof msal.InteractionRequiredAuthError) { return pca.acquireTokenRedirect({ scopes: CFG.scopes, account: acct }).then(function () { throw { redirecting: true }; }); }
            throw e;
          });
      });
    }
    function meta(t) {
      return fetch(base + '?select=id,eTag,lastModifiedDateTime,@microsoft.graph.downloadUrl', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' })
        .then(function (r) {
          if (r.status === 404) throw { notFound: true };
          if (!r.ok) throw new Error('OneDrive: ' + r.status + ' reading the file'); return r.json(); });
    }
    return {
      name: 'OneDrive',
      signedIn: function () { return ready.then(function () { return !!pca.getActiveAccount(); }); },
      signIn: function () { return ready.then(function () { return pca.loginRedirect({ scopes: CFG.scopes, prompt: 'select_account' }); }); },
      signOut: function () { return pca.logoutRedirect(); },
      account: function () { var a = pca.getActiveAccount(); return a ? a.username : ''; },
      etag: function () { return token().then(meta).then(function (m) { return m.eTag; }); },
      load: function () {
        return token().then(meta).then(function (m) {
          return fetch(m['@microsoft.graph.downloadUrl'], { cache: 'no-store' }).then(function (r) { return r.text(); })
            .then(function (txt) { return { data: JSON.parse(txt.replace(/^\uFEFF/, '')), etag: m.eTag }; });
        });
      },
      save: function (data, etag) {
        // only ever overwrite the existing file (If-Match); never create a new / empty one
        if (!etag) return Promise.reject(new Error('no loaded OneDrive file to save to'));
        return token().then(function (t) {
          return fetch(base + ':/content', { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', 'If-Match': etag },
            body: JSON.stringify(data, null, 2) });
        }).then(function (r) {
          if (r.status === 412 || r.status === 409) return { conflict: true };
          if (!r.ok) throw new Error('OneDrive: ' + r.status + ' saving');
          return r.json().then(function (j) { return { etag: j.eTag }; });
        });
      }
    };
  }
  function DemoStore() {
    // keeps a "server" copy in localStorage; ?demo=reset reloads sample.json
    var K = 'cs.demo.server';
    var resetOnce = true;
    function server() { return JSON.parse(localStorage.getItem(K) || 'null'); }
    function put(s) { localStorage.setItem(K, JSON.stringify(s)); }
    return {
      name: 'Demo',
      signedIn: function () { return Promise.resolve(true); },
      account: function () { return 'demo (this browser only)'; },
      etag: function () { return Promise.resolve((server() || {}).etag); },
      load: function () {
        var s = server();
        if (s && !(resetOnce && /demo=reset/.test(location.search))) return Promise.resolve({ data: s.data, etag: s.etag });
        resetOnce = false;
        return fetch('sample-checklist.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
          put({ data: d, etag: 'e1' }); return { data: d, etag: 'e1' }; });
      },
      save: function (data, etag) {
        var s = server();
        if (s && s.etag !== etag) return Promise.resolve({ conflict: true });
        var e = 'e' + (parseInt(((s && s.etag) || 'e0').slice(1), 10) + 1);
        put({ data: clone(data), etag: e }); return Promise.resolve({ etag: e });
      },
      // test hook: change the "server" copy as another device would
      remoteEdit: function (fn) { var s = server(); fn(s.data); s.etag = 'e' + (parseInt(s.etag.slice(1), 10) + 1); put(s); }
    };
  }

  // ------------------------------------------------------------ sync
  var saveTimer = null;
  function changed() {
    state.dirty = true; render(); setStatus('Saving...', 'busy');
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500);
  }
  function flush() {
    if (state.saving || !state.dirty) return Promise.resolve();
    state.saving = true;
    var snapshot = clone(state.data);
    return state.store.save(snapshot, state.etag).then(function (r) {
      if (r.conflict) {
        // changed somewhere else since we loaded: merge both sides by item id, then save again
        return state.store.load().then(function (remote) {
          var m = M.merge(state.base, state.data, remote.data);
          state.data = m.data; state.base = remote.data; state.etag = remote.etag; state.saving = false;
          if (m.notes.length) console.log('merge:', m.notes);
          render(); return flush();
        });
      }
      state.etag = r.etag; state.base = snapshot; state.saving = false;
      state.dirty = JSON.stringify(state.data) !== JSON.stringify(snapshot);
      if (state.dirty) return flush();
      setStatus('Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'ok');
    }).catch(function (e) {
      state.saving = false;
      if (e && e.redirecting) return;
      setStatus('Not saved yet (' + (e && e.message || e) + ') - will retry', 'err');
      clearTimeout(saveTimer); saveTimer = setTimeout(flush, 5000);
    });
  }
  function poll(force) {
    if (!state.store || state.saving || state.dirty) return Promise.resolve();
    return state.store.etag().then(function (e) {
      if (!force && e === state.etag) return;
      return state.store.load().then(function (r) {
        if (state.dirty || state.saving) return;   // an edit started meanwhile; its save will merge
        state.data = r.data; state.base = clone(r.data); state.etag = r.etag; render();
        setStatus('Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 'ok');
      });
    }).catch(function (e) { if (!(e && (e.signin || e.redirecting))) setStatus('Offline? ' + (e && e.message || e), 'err'); });
  }

  // ------------------------------------------------------------ edits
  function find(key, id) { var l = list(key); for (var i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i]; }
  function setDone(key, id, v) { var it = find(key, id); if (it) { it.done = v; changed(); } }
  function addItem(key, text, amount, date) {
    text = (text || '').trim(); if (!text) return;
    var def = defOf(key), ws = parseDay(state.data.weekStart) || today(), t = today(), day = t;
    var end = new Date(ws); end.setDate(end.getDate() + 6);
    if (t < ws || t > end) day = ws;
    var it = { id: newId(key), day: iso(day), text: text, notes: '', done: false };
    if (def.byDay && date) it.day = date;
    if (!def.byDay && date) it.due = date;
    if (def.amount) { var a = parseFloat(String(amount || '').replace(/[$,\s]/g, '')); it.amount = isNaN(a) ? '' : a; }
    if (key === 'payroll') insertByDay(list(key), it); else list(key).push(it);
    changed();
  }
  // new payroll item: right after the last undone item dated the same day or earlier (manual moves are respected);
  // if there is none, above the first undone item
  function insertByDay(l, it) {
    var after = -1, first = -1, d = it.day || '';
    l.forEach(function (o, i) { if (o.done) return; if (first < 0) first = i; if ((o.day || '') <= d) after = i; });
    if (after >= 0) l.splice(after + 1, 0, it); else if (first >= 0) l.splice(first, 0, it); else l.push(it);
  }
  // one time: payroll used to be shown sorted by date; sort the saved list by date once (stable) so it looks
  // the same, then mark it ("payrollManualOrder": true in the file, plus this device) and never auto-sort again
  function payrollToManual(d) {
    if (!d || d.payrollManualOrder === true || localStorage.getItem('cs.payrollManual') === '1') return false;
    var l = Array.isArray(d.payroll) ? d.payroll : [];
    d.payroll = l.map(function (it, idx) { return { it: it, idx: idx }; })
      .sort(function (a, b) { var x = a.it.day || '', y = b.it.day || ''; return x < y ? -1 : x > y ? 1 : a.idx - b.idx; })
      .map(function (p) { return p.it; });
    d.payrollManualOrder = true;
    return true;
  }
  function moveItem(key, id, dir) {
    var def = defOf(key), ord = displayOrder(key).filter(function (p) { return !p.done; });
    var me = ord.filter(function (p) { return String(p.it.id) === String(id); })[0]; if (!me) return;
    if (def.sortByDay) ord = ord.filter(function (p) { return p.day === me.day; });
    var pos = ord.indexOf(me), target = null;
    if (dir === 'up' && pos > 0) target = ord[pos - 1]; if (dir === 'top' && pos > 0) target = ord[0];
    if (dir === 'down' && pos < ord.length - 1) target = ord[pos + 1];
    if (!target) { setStatus(dir === 'down' ? 'Already at the bottom.' : 'Already at the top.'); return; }
    var l = list(key), from = l.indexOf(me.it); l.splice(from, 1);
    var to = l.indexOf(target.it); if (dir === 'down') to += 1; l.splice(to, 0, me.it); changed();
  }
  function deleteItem(key, id) { var l = list(key), it = find(key, id); if (it && confirm('Delete "' + it.text + '"?')) { l.splice(l.indexOf(it), 1); changed(); } }

  // ------------------------------------------------------------ render
  function render() {
    if (!state.data) return;
    var ws = parseDay(state.data.weekStart);
    if (ws) { var we = new Date(ws); we.setDate(we.getDate() + 6);
      $('week').textContent = 'Week of ' + DAYS[ws.getDay()] + ' ' + MON[ws.getMonth()] + ' ' + ws.getDate() + ' \u2013 ' + DAYS[we.getDay()] + ' ' + MON[we.getMonth()] + ' ' + we.getDate(); }
    var n = colCount();
    var y = window.scrollY, h = document.documentElement.scrollHeight;
    var cols = $('cols'); cols.className = n === 4 ? 'c4' : n === 2 ? 'c2' : ''; cols.classList.toggle('reorder', state.reorder);
    cols.innerHTML = '';
    var colEls = []; for (var i = 0; i < n; i++) { var c = el('div', 'col'); colEls.push(c); cols.appendChild(c); }
    $('listbar').classList.toggle('hidden', !state.reorder);
    state.listOrder.forEach(function (key) { colEls[homeCol(key, n)].appendChild(card(defOf(key), n)); });
    if (state.cols && state.cols !== n && h > 0) window.scrollTo(0, y * document.documentElement.scrollHeight / h);
    state.cols = n;
  }
  function card(def, n) {
    var key = def.key, acc = ACC[key];
    var c = el('section', 'card ' + key + (state.collapsed[key] ? ' collapsed' : ''));
    c.style.setProperty('--acc', acc); c.style.setProperty('--cbg', hexA(acc, .09)); c.style.setProperty('--cb', hexA(acc, .38));
    c.style.setProperty('--rbg', hexA(acc, .07)); c.style.setProperty('--rb', hexA(acc, .22));
    c.style.setProperty('--tbg', hexA(acc, .16)); c.style.setProperty('--tb', hexA(acc, .5)); c.style.setProperty('--tfg', lighten(acc, .35));
    var items = list(key), done = items.filter(function (i) { return i.done; }).length;
    var h = el('div', 'card-h'), coll = !!state.collapsed[key];
    h.setAttribute('role', 'button'); h.setAttribute('aria-expanded', String(!coll));
    h.title = coll ? 'Tap to expand' : 'Tap to collapse';
    h.appendChild(el('span', 'caret', '\u25BE'));
    var nm = el('span', 'name', def.title + ' '); nm.appendChild(el('span', 'n', '(' + items.length + ')')); h.appendChild(nm);
    if (items.length) h.appendChild(el('span', 'count', done + ' of ' + items.length + ' done'));
    // reorder mode: move the whole list (up/down/top; left/right between columns in the wide layouts)
    var lm = el('div', 'lmv');
    function lbtn(label, title, dir) { var b = el('button', '', label); b.title = title; b.setAttribute('aria-label', title);
      b.onclick = function (e) { e.stopPropagation(); moveList(key, dir); }; lm.appendChild(b); }
    lbtn('\u21C8', 'Move list to top', 'top'); lbtn('\u25B2', 'Move list up', 'up'); lbtn('\u25BC', 'Move list down', 'down');
    if (n > 1) { lbtn('\u25C0', 'Move list to the column on the left', 'left'); lbtn('\u25B6', 'Move list to the column on the right', 'right'); }
    h.appendChild(lm);
    h.onclick = function () {   // toggle in place so the chevron animates
      state.collapsed[key] = !state.collapsed[key]; saveLayout();
      var cc = !!state.collapsed[key]; c.classList.toggle('collapsed', cc); h.setAttribute('aria-expanded', String(!cc)); h.title = cc ? 'Tap to expand' : 'Tap to collapse';
    };
    c.appendChild(h);
    var body = el('div', 'body');
    displayOrder(key).forEach(function (p) { body.appendChild(row(def, p.it)); });
    body.appendChild(addRow(def));
    c.appendChild(body);
    return c;
  }
  function row(def, it) {
    var key = def.key, t = today();
    var r = el('div', 'row' + (it.done ? ' done' : ''));
    r.appendChild(el('div', 'bar'));
    var cb = el('button', 'cb', it.done ? '\u2713' : ''); cb.setAttribute('aria-label', it.done ? 'Mark not done' : 'Mark done');
    cb.onclick = function () { setDone(key, it.id, !it.done); };
    r.appendChild(cb);
    var info = el('div', 'info'), line = el('div', 'line');
    line.appendChild(el('span', 'text', it.text));
    if (def.amount && money(it.amount)) line.appendChild(el('span', 'amt', money(it.amount)));
    var dd = def.byDay ? parseDay(it.day) : parseDay(it.due);
    if (dd && (key === 'payroll' || !def.byDay || key === 'bills')) {
      var over = !it.done && dd < t; if (over) r.classList.add('over');
      line.appendChild(el('span', 'tag' + (over ? ' over' : ''), tagText(dd)));
    }
    info.appendChild(line);
    if (it.notes) info.appendChild(el('div', 'notes' + (/^carried over/i.test(it.notes) ? ' carried' : ''), it.notes));
    info.onclick = function () { openSheet(def, it); };
    r.appendChild(info);
    if (!it.done) {
      var mv = el('div', 'mv'), up = el('button', '', '\u25B2'), dn = el('button', '', '\u25BC');
      up.title = 'Move up'; dn.title = 'Move down';
      up.onclick = function () { moveItem(key, it.id, 'up'); }; dn.onclick = function () { moveItem(key, it.id, 'down'); };
      mv.appendChild(up); mv.appendChild(dn); r.appendChild(mv);
    }
    return r;
  }
  function addRow(def) {
    var f = el('form', 'add'), t = el('input', 't'); t.placeholder = def.hint; t.enterKeyHint = 'done'; f.appendChild(t);
    var a = null; if (def.amount) { a = el('input', 'a'); a.placeholder = '$ Amt'; a.inputMode = 'decimal'; f.appendChild(a); }
    var d = el('input', 'd'); d.type = 'date'; d.title = def.byDay ? 'Day' : 'Due date (optional)'; f.appendChild(d);
    var b = el('button', '', '+'); b.type = 'submit'; b.setAttribute('aria-label', 'Add'); f.appendChild(b);
    f.onsubmit = function (e) { e.preventDefault(); addItem(def.key, t.value, a && a.value, d.value); };
    return f;
  }
  function openSheet(def, it) {
    var s = $('sheet'), p = el('div', 'panel'); s.innerHTML = ''; s.appendChild(p);
    p.appendChild(el('label', '', def.title));
    var tx = el('input'); tx.value = it.text; p.appendChild(tx);
    p.appendChild(el('label', '', 'Notes')); var nt = el('textarea'); nt.rows = 2; nt.value = it.notes || ''; p.appendChild(nt);
    var am = null; if (def.amount) { p.appendChild(el('label', '', 'Amount')); am = el('input'); am.inputMode = 'decimal'; am.value = it.amount === '' || it.amount == null ? '' : it.amount; p.appendChild(am); }
    p.appendChild(el('label', '', def.byDay ? 'Day' : 'Due date (optional)')); var du = el('input'); du.type = 'date'; du.value = (def.byDay ? it.day : it.due) || ''; p.appendChild(du);
    var bs = el('div', 'btns');
    function btn(label, cls, fn) { var b = el('button', cls, label); b.onclick = fn; bs.appendChild(b); }
    if (!it.done) { btn('Move to top', '', function () { close(); moveItem(def.key, it.id, 'top'); });
      btn('Move up', '', function () { close(); moveItem(def.key, it.id, 'up'); }); btn('Move down', '', function () { close(); moveItem(def.key, it.id, 'down'); }); }
    btn('Delete', 'danger', function () { close(); deleteItem(def.key, it.id); });
    btn('Cancel', '', close);
    btn('Save', 'primary', function () {
      var x = find(def.key, it.id); if (!x) return close();
      x.text = tx.value.trim() || x.text; x.notes = nt.value;
      if (am) { var v = parseFloat(String(am.value).replace(/[$,\s]/g, '')); x.amount = isNaN(v) ? '' : v; }
      if (def.byDay) { if (du.value) x.day = du.value; } else if (du.value) x.due = du.value; else delete x.due;
      close(); changed();
    });
    p.appendChild(bs);
    s.classList.remove('hidden'); s.onclick = function (e) { if (e.target === s) close(); };
    function close() { s.classList.add('hidden'); s.innerHTML = ''; }
  }

  // ------------------------------------------------------------ start
  function start() {
    var demo = !CFG.clientId || /[?&]demo/.test(location.search);
    if (!demo && typeof msal === 'undefined') { setStatus('Sign-in library failed to load.', 'err'); return; }
    state.store = demo ? DemoStore() : GraphStore();
    window.__cs = state;   // for testing
    $('btnReorder').onclick = function () { state.reorder = !state.reorder; this.classList.toggle('on', state.reorder); render(); };
    $('btnCollapseAll').onclick = function () { setAllCollapsed(true); };
    $('btnExpandAll').onclick = function () { setAllCollapsed(false); };
    $('btnResetOrder').onclick = function () { if (confirm('Put the lists back in their default order?')) resetLayout(); };
    $('btnRefresh').onclick = function () { flush().then(function () { return poll(true); }); };
    $('btnAccount').onclick = function () { var a = state.store.account && state.store.account(); if (state.store.signOut && confirm('Signed in as ' + a + '. Sign out?')) state.store.signOut(); else if (!state.store.signOut) alert(a); };
    $('btnSignIn').onclick = function () { state.store.signIn(); };
    $('btnRetry').onclick = function () { location.reload(); };
    state.store.signedIn().then(function (ok) {
      if (!ok) { $('signin').classList.remove('hidden'); setStatus(''); return; }
      setStatus('Loading...', 'busy');
      return state.store.load().then(function (r) {
        state.data = r.data; state.base = clone(r.data); state.etag = r.etag; render();
        setStatus('Loaded from ' + state.store.name, 'ok');
        if (payrollToManual(state.data)) changed();
        localStorage.setItem('cs.payrollManual', '1');
        setInterval(function () { if (!document.hidden) poll(); }, (CFG.pollSeconds || 15) * 1000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); else flush(); });
        window.addEventListener('resize', function () { if (colCount() !== state.cols) render(); });
      });
    }).catch(function (e) {
      if (e && e.redirecting) return;
      if (e && e.notFound) { $('missing').classList.remove('hidden'); setStatus(''); return; }
      setStatus('Could not load: ' + (e && e.message || JSON.stringify(e)), 'err');
    });
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
  }
  start();
})();
