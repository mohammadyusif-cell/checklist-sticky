'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BOUNDS = { width: 1180, height: 800 };

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)));
}

function clampBounds(input, fallback) {
  const fb = fallback || DEFAULT_BOUNDS;
  const src = input && typeof input === 'object' ? input : {};
  const out = {
    width: clampNum(src.width, 480, 4000, fb.width),
    height: clampNum(src.height, 480, 3000, fb.height),
    alwaysOnTop: src.alwaysOnTop === true,
    isFullScreen: src.isFullScreen === true
  };
  if (Number.isFinite(src.x) && src.x >= -200 && src.x <= 8000) out.x = Math.round(src.x);
  if (Number.isFinite(src.y) && src.y >= -200 && src.y <= 8000) out.y = Math.round(src.y);
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function readWindowState(file) {
  return clampBounds(readJson(file), DEFAULT_BOUNDS);
}

function writeWindowState(file, state) {
  const clean = clampBounds(state, DEFAULT_BOUNDS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(clean) + '\n', { mode: 0o600 });
  return clean;
}

function readMode(file) {
  const json = readJson(file);
  if (json && (json.mode === 'demo' || json.mode === 'cloud')) return json.mode;
  return null;
}

function writeMode(file, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (mode !== 'demo' && mode !== 'cloud') {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.writeFileSync(file, JSON.stringify({ mode: mode }) + '\n', { mode: 0o600 });
}

module.exports = {
  DEFAULT_BOUNDS,
  clampBounds,
  readWindowState,
  writeWindowState,
  readMode,
  writeMode
};
