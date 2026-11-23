'use strict';

// Microsoft Graph access for the existing OneDrive checklist file.
// This client can read and conditionally overwrite that one file.
// It never creates it, never deletes it, and never calls another path.

function encodePath(dataPath) {
  if (typeof dataPath !== 'string' || !dataPath || dataPath.includes('..') || dataPath.startsWith('/') || dataPath.includes('\\')) {
    throw new Error('Refusing unexpected checklist path.');
  }
  return encodeURI(dataPath).replace(/#/g, '%23');
}

function metaUrl(dataPath) {
  return 'https://graph.microsoft.com/v1.0/me/drive/root:/' + encodePath(dataPath) + '?select=id,eTag,lastModifiedDateTime,@microsoft.graph.downloadUrl';
}

function contentUrl(dataPath) {
  return 'https://graph.microsoft.com/v1.0/me/drive/root:/' + encodePath(dataPath) + ':/content';
}

function assertDownloadUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Refusing non-https checklist download.');
  if (parsed.username || parsed.password) throw new Error('Refusing checklist download with credentials.');
  return parsed.toString();
}

function assertChecklistDocument(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Refusing to save a non-object checklist.');
  const body = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(body) > 8000000) throw new Error('Refusing to save a checklist larger than 8 MB.');
  return body;
}

function assertEtag(etag) {
  if (typeof etag !== 'string' || !etag.trim() || etag.length > 500 || /[\r\n]/.test(etag)) {
    throw new Error('Refusing to save without the loaded OneDrive eTag.');
  }
  return etag;
}

async function graphStatusError(response, action) {
  let code = '';
  try {
    const json = await response.json();
    if (json && json.error && typeof json.error.code === 'string') code = json.error.code.slice(0, 80);
  } catch (e) { /* status is enough */ }
  const err = new Error('OneDrive: ' + response.status + (code ? ' ' + code : '') + ' ' + action);
  err.status = response.status;
  if (response.status === 401) err.code = 'signin';
  return err;
}

async function authorized(fetchFn, method, url, token, extraHeaders, body) {
  if (method !== 'GET' && method !== 'PUT') throw new Error('Refusing Graph method ' + method);
  if (!url.startsWith('https://graph.microsoft.com/v1.0/me/drive/root:/')) throw new Error('Refusing Graph URL.');
  const headers = Object.assign({ Authorization: 'Bearer ' + token }, extraHeaders || {});
  return fetchFn(url, { method: method, headers: headers, body: body, cache: 'no-store' });
}

async function loadChecklist(fetchFn, token, dataPath) {
  const metaResponse = await authorized(fetchFn, 'GET', metaUrl(dataPath), token);
  if (metaResponse.status === 404) {
    const err = new Error('not found');
    err.notFound = true;
    throw err;
  }
  if (!metaResponse.ok) throw await graphStatusError(metaResponse, 'reading the file');
  const meta = await metaResponse.json();
  const download = assertDownloadUrl(meta['@microsoft.graph.downloadUrl']);
  const fileResponse = await fetchFn(download, { method: 'GET', cache: 'no-store' });
  if (!fileResponse.ok) throw await graphStatusError(fileResponse, 'reading the file');
  const text = await fileResponse.text();
  let data;
  try { data = JSON.parse(String(text).replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error('OneDrive checklist is not valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('OneDrive checklist is not a document.');
  return { data: data, etag: meta.eTag };
}

async function saveChecklist(fetchFn, token, dataPath, data, etag) {
  const match = assertEtag(etag);
  const body = assertChecklistDocument(data);
  const response = await authorized(fetchFn, 'PUT', contentUrl(dataPath), token, {
    'Content-Type': 'application/json',
    'If-Match': match
  }, body);
  if (response.status === 412 || response.status === 409) return { conflict: true };
  if (response.status === 404) {
    const err = new Error('not found');
    err.notFound = true;
    throw err;
  }
  if (!response.ok) throw await graphStatusError(response, 'saving');
  const json = await response.json();
  return { etag: json.eTag };
}

async function readEtag(fetchFn, token, dataPath) {
  const response = await authorized(fetchFn, 'GET', metaUrl(dataPath), token);
  if (response.status === 404) {
    const err = new Error('not found');
    err.notFound = true;
    throw err;
  }
  if (!response.ok) throw await graphStatusError(response, 'reading the file');
  const meta = await response.json();
  return meta.eTag;
}

module.exports = {
  encodePath,
  metaUrl,
  contentUrl,
  assertDownloadUrl,
  assertChecklistDocument,
  loadChecklist,
  saveChecklist,
  readEtag
};
