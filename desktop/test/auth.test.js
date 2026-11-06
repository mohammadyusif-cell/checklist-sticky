'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const auth = require('../src/auth');

const config = fs.readFileSync(path.join(__dirname, '..', '..', 'config.js'), 'utf8');
const web = auth.readWebConfig(config);

function fakeJwt(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return 'eyJhbGciOiJub25lIn0.' + body + '.sig';
}

test('web config is a public client with the OneDrive checklist path', () => {
  assert.equal(web.authority, 'https://login.microsoftonline.com/consumers');
  assert.equal(web.dataPath, 'Checklist Sticky/checklist.json');
  assert.ok(web.clientId);
  assert.equal(web.scopes.includes('https://graph.microsoft.com/Files.ReadWrite'), true);
  assert.equal(config.includes('client_secret'), false);
});

test('authorize URL is the system-browser PKCE request and has no secret', () => {
  const pkce = auth.createPkce();
  const state = auth.createState();
  const url = new URL(auth.buildAuthorizeUrl({
    authority: web.authority,
    clientId: web.clientId,
    redirectUri: 'http://localhost:54321',
    state: state,
    pkce: pkce
  }));
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:54321');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), pkce.challenge);
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.match(url.searchParams.get('scope'), /Files\.ReadWrite/);
  assert.match(url.searchParams.get('scope'), /offline_access/);
});

test('refuses to open a sign-in URL that is not Microsoft', () => {
  assert.throws(() => auth.assertMicrosoftAuthorizeUrl('https://example.test/authorize'), /unexpected sign-in/);
  assert.throws(() => auth.assertMicrosoftAuthorizeUrl('http://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'), /unexpected sign-in/);
  assert.throws(() => auth.buildAuthorizeUrl({
    authority: 'https://evil.test/consumers',
    clientId: 'abc',
    redirectUri: 'http://localhost:1',
    state: 's',
    pkce: auth.createPkce()
  }), /authority/);
});

test('token exchange sends the verifier and never a client secret', async () => {
  let seen = null;
  const fetchFn = async (url, options) => {
    seen = { url: String(url), body: options.body };
    return new Response(JSON.stringify({
      access_token: 'access-test',
      refresh_token: 'refresh-test',
      expires_in: 1800,
      id_token: fakeJwt({ preferred_username: 'person@example.test' })
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const tokens = await auth.exchangeAuthorizationCode(fetchFn, {
    authority: web.authority,
    clientId: web.clientId,
    code: 'code-test',
    redirectUri: 'http://localhost:9',
    codeVerifier: 'verifier-test'
  });
  assert.equal(new URL(seen.url).pathname, '/consumers/oauth2/v2.0/token');
  const body = new URLSearchParams(seen.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code_verifier'), 'verifier-test');
  assert.equal(body.get('client_secret'), null);
  assert.equal(tokens.account, 'person@example.test');
  assert.equal(tokens.accessToken, 'access-test');
  assert.ok(tokens.expiresAt > Date.now());
});

test('redirect mismatch and public-client errors stay actionable and secret-free', () => {
  const redirect = auth.friendlyMicrosoftError({ error: 'invalid_request', error_description: 'AADSTS50011: redirect uri mismatch' });
  assert.match(redirect.message, /http:\/\/localhost/);
  assert.match(redirect.message, /Nothing was changed on OneDrive/);
  assert.equal(redirect.message.includes('client_secret'), false);
  const secret = auth.friendlyMicrosoftError({ error: 'invalid_client', error_description: 'AADSTS7000218: client_secret is missing' });
  assert.match(secret.message, /do not create a client secret/i);
  assert.equal(auth.shouldClearSession({ error: 'invalid_grant' }), true);
  assert.equal(auth.shouldClearSession({ error: 'invalid_request' }), false);
});

test('loopback login accepts only the matching state and does not echo the code', async () => {
  let listened = null;
  const fetchFn = async () => new Response(JSON.stringify({
    access_token: 'access-test',
    refresh_token: 'refresh-test',
    expires_in: 3600,
    id_token: fakeJwt({ preferred_username: 'person@example.test' })
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const tokens = await auth.startLoopbackLogin({
    clientId: web.clientId,
    authority: web.authority,
    fetchFn: fetchFn,
    timeoutMs: 5000,
    onListen: function (info) { listened = info; },
    openBrowser: async function (authorize) {
      const url = new URL(authorize);
      assert.equal(listened.address, '127.0.0.1');
      assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:' + listened.port);
      const callback = url.searchParams.get('redirect_uri') + '/?code=callback-secret-code&state=' + url.searchParams.get('state');
      const response = await fetch(callback);
      const html = await response.text();
      assert.equal(html.includes('callback-secret-code'), false);
      assert.equal(html.includes(web.clientId), false);
      assert.match(html, /Signed in/);
    }
  });
  assert.equal(tokens.accessToken, 'access-test');
  assert.equal(tokens.account, 'person@example.test');
});

test('a mismatched state does not exchange a code', async () => {
  let fetched = 0;
  await assert.rejects(() => auth.startLoopbackLogin({
    clientId: web.clientId,
    authority: web.authority,
    timeoutMs: 5000,
    fetchFn: async () => { fetched += 1; return new Response('{}', { status: 400 }); },
    openBrowser: async function (authorize) {
      const url = new URL(authorize);
      const callback = url.searchParams.get('redirect_uri') + '/?code=nope&state=wrong-state';
      const response = await fetch(callback);
      const html = await response.text();
      assert.match(html, /did not finish/);
      assert.equal(html.includes('nope'), false);
    }
  }), /did not match/);
  assert.equal(fetched, 0);
});

test('callback HTML is static', () => {
  assert.equal(auth.CALLBACK_OK_HTML.includes('code'), false);
  assert.equal(auth.CALLBACK_ERR_HTML.includes('${'), false);
});
