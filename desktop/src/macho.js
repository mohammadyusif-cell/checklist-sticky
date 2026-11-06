'use strict';

// Reads the architecture and minimum OS from a thin Mach-O 64-bit header.
// Used to describe a packaged binary. It does not sign or modify the file.

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;
const CPU_TYPE_X86_64 = 0x01000007;
const LC_BUILD_VERSION = 0x32;
const LC_VERSION_MIN_MACOSX = 0x24;
const PLATFORM_MACOS = 1;

function versionString(value) {
  const major = (value >> 16) & 0xffff;
  const minor = (value >> 8) & 0xff;
  const patch = value & 0xff;
  return major + '.' + minor + '.' + patch;
}

function parseMachO(buffer) {
  if (!buffer || buffer.length < 32) return { ok: false, error: 'too small' };
  const magic = buffer.readUInt32LE(0);
  if (magic !== MH_MAGIC_64) return { ok: false, error: 'not a thin 64-bit Mach-O' };
  const cpu = buffer.readUInt32LE(4);
  let arch = 'unknown';
  if (cpu === CPU_TYPE_ARM64) arch = 'arm64';
  else if (cpu === CPU_TYPE_X86_64) arch = 'x64';
  const ncmds = buffer.readUInt32LE(16);
  const sizeofcmds = buffer.readUInt32LE(20);
  let offset = 32;
  const end = Math.min(buffer.length, 32 + sizeofcmds);
  let minos = '';
  let sdk = '';
  let platform = 0;
  for (let i = 0; i < ncmds && offset + 8 <= end; i++) {
    const cmd = buffer.readUInt32LE(offset);
    const cmdsize = buffer.readUInt32LE(offset + 4);
    if (cmdsize < 8 || offset + cmdsize > buffer.length) break;
    if (cmd === LC_BUILD_VERSION && cmdsize >= 24) {
      platform = buffer.readUInt32LE(offset + 8);
      minos = versionString(buffer.readUInt32LE(offset + 12));
      sdk = versionString(buffer.readUInt32LE(offset + 16));
    } else if (cmd === LC_VERSION_MIN_MACOSX && cmdsize >= 16 && !minos) {
      platform = PLATFORM_MACOS;
      minos = versionString(buffer.readUInt32LE(offset + 8));
      sdk = versionString(buffer.readUInt32LE(offset + 12));
    }
    offset += cmdsize;
  }
  return {
    ok: arch === 'arm64' && platform === PLATFORM_MACOS && !!minos,
    arch: arch,
    platform: platform === PLATFORM_MACOS ? 'macos' : String(platform),
    minos: minos,
    sdk: sdk
  };
}

module.exports = { parseMachO, versionString };
