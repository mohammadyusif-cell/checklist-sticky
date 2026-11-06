'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const graph = require('../src/graph');

const dataPath = 'Checklist Sticky/checklist.json';
const etag = 'etag-1';
const fixture = { weekStart: '2026-11-02', tasks: [{ id: 't1', text: 'Sample', done: false }], history: [] };

function jsonResponse(status, body, headers) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: status,
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {})
  });
}

test('load reads the download URL and does not create a missing file', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), method: options.method, headers: options.headers || {} });
    if (calls.length === 1) {
      return jsonResponse(200, {
        id: 'item',
        eTag: etag,
        '@microsoft.graph.downloadUrl': 'https://download.example.test/checklist.json'
      });
    }
    return new Response('\uFEFF' + JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const loaded = await graph.loadChecklist(fetchFn, 'token-test', dataPath);
  assert.equal(loaded.etag, etag);
  assert.equal(loaded.data.tasks[0].id, 't1');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, graph.metaUrl(dataPath));
  assert.equal(calls[0].headers.Authorization, 'Bearer token-test');
  assert.equal(calls[1].url, 'https://download.example.test/checklist.json');
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(calls.some(call => call.method === 'PUT' || call.method === 'DELETE'), false);
});

test('a missing checklist is not created', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push(options.method + ' ' + url);
    return jsonResponse(404, { error: { code: 'itemNotFound' } });
  };
  await assert.rejects(() => graph.loadChecklist(fetchFn, 'token-test', dataPath), (err) => err.notFound === true);
  await assert.rejects(() => graph.saveChecklist(fetchFn, 'token-test', dataPath, fixture, ''), /eTag/);
  assert.deepEqual(calls, ['GET ' + graph.metaUrl(dataPath)]);
});

test('save requires If-Match and reports a conflict without deleting', async () => {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url: String(url), method: options.method, headers: options.headers, body: options.body });
    return jsonResponse(412, { error: { code: 'preconditionFailed' } });
  };
  const result = await graph.saveChecklist(fetchFn, 'token-test', dataPath, fixture, etag);
  assert.deepEqual(result, { conflict: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].url, graph.contentUrl(dataPath));
  assert.equal(calls[0].headers['If-Match'], etag);
  assert.equal(calls[0].headers.Authorization, 'Bearer token-test');
  assert.equal(calls[0].body, JSON.stringify(fixture, null, 2));
  assert.equal(JSON.stringify(calls).includes('DELETE'), false);
});

test('download URLs must be https and Graph methods other than GET or PUT are refused', async () => {
  assert.throws(() => graph.assertDownloadUrl('http://download.example.test/file'), /non-https/);
  assert.throws(() => graph.assertDownloadUrl('https://user:secret@download.example.test/file'), /credentials/);
  assert.throws(() => graph.encodePath('../checklist.json'), /path/);
  const fetchFn = async () => { throw new Error('network should not be called'); };
  await assert.rejects(() => graph.loadChecklist(fetchFn, 't', 'Checklist Sticky/checklist.json'), /network/);
  const meta = graph.metaUrl(dataPath);
  assert.equal(meta.startsWith('https://graph.microsoft.com/v1.0/me/drive/root:/Checklist%20Sticky/checklist.json?'), true);
  assert.equal(graph.contentUrl(dataPath).endsWith(':/content'), true);
});

test('source does not issue a delete', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'graph.js'), 'utf8');
  assert.equal(source.includes("method !== 'GET' && method !== 'PUT'"), true);
  assert.equal(/method:\s*'DELETE'|method:\s*"DELETE"/.test(source), false);
});
