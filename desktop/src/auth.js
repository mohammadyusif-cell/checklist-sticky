'use strict';

const crypto = require('crypto');
const http = require('http');

const BIND_HOST = '127.0.0.1';
const SCOPES = ['openid', 'profile', 'offline_access', 'https://graph.microsoft.com/Files.ReadWrite'];

const CALLBACK_OK_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Checklist Sticky</title>'
  + '<style>body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;background:#16181e;color:#f2f2f7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}div{max-width:28rem;text-align:center;padding:24px}</style>'
  + '</head><body><div><p>Signed in. You can close this window and return to Checklist Sticky.</p></div></body></html>';

const CALLBACK_ERR_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Checklist Sticky</title>'
  + '<style>body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;background:#16181e;color:#f2f2f7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}div{max-width:28rem;text-align:center;padding:24px}</style>'
  + '</head><body><div><p>Sign-in did not finish. You can close this window and return to Checklist Sticky.</p></div></body></html>';

function createPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier: verifier, challenge: challenge, method: 'S256' };
}

function createState() {
  return crypto.randomBytes(16).toString('base64url');
}

function assertAuthority(authority) {
  if (!/^https:\/\/login\.microsoftonline\.com\/[A-Za-z0-9.-]+$/.test(authority || '')) {
    throw new Error('Refusing unexpected Microsoft authority.');
  }
  return authority;
}

function assertMicrosoftAuthorizeUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'login.microsoftonline.com') {
    throw new Error('Refusing to open an unexpected sign-in URL.');
  }
  if (parsed.searchParams.has('client_secret')) throw new Error('Refusing a sign-in URL that contains a client secret.');
  return parsed.toString();
}

function buildAuthorizeUrl(options) {
  const authority = assertAuthority(options.authority);
  const pkce = options.pkce;
  const url = new URL(authority.replace(/\/$/, '') + '/oauth2/v2.0/authorize');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', (options.scopes || SCOPES).join(' '));
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', pkce.method);
  url.searchParams.set('prompt', 'select_account');
  return assertMicrosoftAuthorizeUrl(url.toString());
}

function tokenEndpoint(authority) {
  return assertAuthority(authority).replace(/\/$/, '') + '/oauth2/v2.0/token';
}

function accountFromIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return '';
  const parts = idToken.split('.');
  if (parts.length < 2) return '';
  try {
    const json = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const name = json.preferred_username || json.email || '';
    return typeof name === 'string' ? name.slice(0, 200) : '';
  } catch (e) {
    return '';
  }
}

function normalizeTokenResponse(json, previous) {
  if (!json || typeof json.access_token !== 'string' || !json.access_token) {
    throw friendlyMicrosoftError(json || { error: 'invalid_response' });
  }
  const expiresIn = Number(json.expires_in);
  const lifetime = Number.isFinite(expiresIn) && expiresIn > 30 ? expiresIn : 3600;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token
      ? json.refresh_token
      : (previous && previous.refreshToken) || '',
    expiresAt: Date.now() + lifetime * 1000,
    account: accountFromIdToken(json.id_token) || (previous && previous.account) || ''
  };
}

function shouldClearSession(payload) {
  return !!(payload && payload.error === 'invalid_grant');
}

function friendlyMicrosoftError(payload) {
  const error = payload && payload.error ? String(payload.error) : 'sign-in';
  const description = payload && payload.error_description ? String(payload.error_description) : '';
  const code = (description.match(/AADSTS\d+/) || [])[0] || error;
  let message;
  if (code === 'AADSTS50011' || /redirect uri/i.test(description)) {
    message = 'Microsoft rejected the sign-in redirect. In the Entra app registration, add a Mobile and desktop platform with the redirect URI http://localhost. Nothing was changed on OneDrive.';
  } else if (code === 'AADSTS7000218' || code === 'AADSTS700025') {
    message = 'This Microsoft app registration is not set up as a public client yet. Add the Mobile and desktop platform with redirect URI http://localhost, and do not create a client secret. Nothing was changed on OneDrive.';
  } else if (error === 'access_denied') {
    message = 'Sign-in was cancelled. Nothing was changed on OneDrive.';
  } else {
    message = 'Sign-in failed (' + code + '). Nothing was changed on OneDrive.';
  }
  const err = new Error(message);
  err.code = code;
  return err;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function formBody(fields) {
  const params = new URLSearchParams();
  Object.keys(fields).forEach(function (key) {
    if (fields[key] != null && fields[key] !== '') params.set(key, fields[key]);
  });
  if (params.has('client_secret')) throw new Error('Refusing to send a client secret.');
  return params.toString();
}

async function postToken(fetchFn, authority, fields) {
  const response = await fetchFn(tokenEndpoint(authority), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(fields)
  });
  let json = {};
  try { json = await response.json(); } catch (e) { json = {}; }
  if (!response.ok || !json.access_token) {
    const err = friendlyMicrosoftError(json);
    err.clearSession = shouldClearSession(json);
    throw err;
  }
  return json;
}

async function exchangeAuthorizationCode(fetchFn, options) {
  const json = await postToken(fetchFn, options.authority, {
    client_id: options.clientId,
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
    scope: (options.scopes || SCOPES).join(' ')
  });
  return normalizeTokenResponse(json, null);
}

async function refreshTokens(fetchFn, options) {
  const json = await postToken(fetchFn, options.authority, {
    client_id: options.clientId,
    grant_type: 'refresh_token',
    refresh_token: options.refreshToken,
    scope: (options.scopes || SCOPES).join(' ')
  });
  return normalizeTokenResponse(json, options.previous || null);
}

function hostAllowed(hostHeader, port) {
  const host = String(hostHeader || '').toLowerCase().replace(/\/$/, '');
  return host === 'localhost:' + port || host === '127.0.0.1:' + port || host === '[::1]:' + port;
}

function startLoopbackLogin(options) {
  const clientId = options.clientId;
  const authority = assertAuthority(options.authority);
  const scopes = options.scopes || SCOPES;
  const fetchFn = options.fetchFn;
  const openBrowser = options.openBrowser;
  const timeoutMs = options.timeoutMs || 5 * 60 * 1000;
  if (!clientId) {
    return Promise.reject(Object.assign(new Error('No public client id is configured.'), { code: 'no-client' }));
  }
  if (typeof openBrowser !== 'function' || typeof fetchFn !== 'function') {
    return Promise.reject(new Error('Sign-in is missing a browser or token handler.'));
  }

  const pkce = createPkce();
  const state = createState();
  let settled = false;
  let timer = null;
  const servers = [];
  const sockets = new Set();

  function finish(fn, value) {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    servers.forEach(function (server) { server.close(); });
    sockets.forEach(function (socket) { socket.destroy(); });
    fn(value);
  }

  function track(server) {
    servers.push(server);
    server.on('connection', function (socket) {
      sockets.add(socket);
      socket.on('close', function () { sockets.delete(socket); });
    });
  }

  const promise = new Promise(function (resolve, reject) {
    function onRequest(port, req, res) {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const headers = {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'Connection': 'close'
      };
      if (req.method !== 'GET' || !hostAllowed(req.headers.host, port) || url.pathname !== '/') {
        res.writeHead(404, headers);
        res.end(CALLBACK_ERR_HTML);
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const badState = !safeEqual(returnedState, state);
      const badCode = !code || code.length > 2000 || /\s/.test(code);
      const failed = !!(error || badCode || badState);
      res.writeHead(200, headers);
      res.end(failed ? CALLBACK_ERR_HTML : CALLBACK_OK_HTML, function () {
        if (error) {
          finish(reject, friendlyMicrosoftError({
            error: error,
            error_description: url.searchParams.get('error_description') || ''
          }));
          return;
        }
        if (badCode || badState) {
          finish(reject, Object.assign(new Error('Sign-in response did not match this app. Nothing was changed on OneDrive.'), { code: 'state' }));
          return;
        }
        exchangeAuthorizationCode(fetchFn, {
          authority: authority,
          clientId: clientId,
          code: code,
          redirectUri: 'http://localhost:' + port,
          codeVerifier: pkce.verifier,
          scopes: scopes
        }).then(function (tokens) { finish(resolve, tokens); }, function (err) { finish(reject, err); });
      });
    }

    function begin(port) {
      let authorize;
      try {
        authorize = buildAuthorizeUrl({
          authority: authority,
          clientId: clientId,
          redirectUri: 'http://localhost:' + port,
          scopes: scopes,
          state: state,
          pkce: pkce
        });
      } catch (err) {
        finish(reject, err);
        return;
      }
      if (typeof options.onListen === 'function') options.onListen({ address: BIND_HOST, port: port });
      Promise.resolve(openBrowser(authorize)).catch(function (err) { finish(reject, err); });
    }

    const v4 = http.createServer(function (req, res) { onRequest(v4.address().port, req, res); });
    track(v4);
    v4.on('error', function (err) { finish(reject, err); });
    v4.listen(0, BIND_HOST, function () {
      const port = v4.address().port;
      const v6 = http.createServer(function (req, res) { onRequest(port, req, res); });
      v6.once('error', function () { begin(port); });
      v6.listen(port, '::1', function () {
        track(v6);
        begin(port);
      });
    });
    timer = setTimeout(function () {
      finish(reject, Object.assign(new Error('Sign-in timed out. Nothing was changed on OneDrive.'), { code: 'timeout' }));
    }, timeoutMs);
  });

  promise.cancel = function () {
    finish(function () {}, null);
  };
  return promise;
}

function readWebConfig(configText) {
  const text = String(configText || '');
  const clientId = (text.match(/clientId:\s*'([^']*)'/) || [])[1] || '';
  const authority = (text.match(/authority:\s*'([^']*)'/) || [])[1] || 'https://login.microsoftonline.com/consumers';
  const dataPath = (text.match(/dataPath:\s*'([^']*)'/) || [])[1] || '';
  assertAuthority(authority);
  encodePathSafe(dataPath);
  return { clientId: clientId, authority: authority, dataPath: dataPath, scopes: SCOPES.slice() };
}

function encodePathSafe(dataPath) {
  if (typeof dataPath !== 'string' || !dataPath || dataPath.includes('..') || dataPath.startsWith('/') || dataPath.includes('\\')) {
    throw new Error('Refusing unexpected checklist path.');
  }
  return dataPath;
}

module.exports = {
  BIND_HOST,
  SCOPES,
  CALLBACK_OK_HTML,
  CALLBACK_ERR_HTML,
  createPkce,
  createState,
  assertAuthority,
  assertMicrosoftAuthorizeUrl,
  buildAuthorizeUrl,
  tokenEndpoint,
  accountFromIdToken,
  normalizeTokenResponse,
  shouldClearSession,
  friendlyMicrosoftError,
  exchangeAuthorizationCode,
  refreshTokens,
  startLoopbackLogin,
  readWebConfig
};
