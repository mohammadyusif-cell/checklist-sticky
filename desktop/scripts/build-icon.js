'use strict';

const fs = require('fs');
const path = require('path');

// Apple icon type ic09 is a 512x512 PNG. The repo icon is already 512.
const png = fs.readFileSync(path.join(__dirname, '..', '..', 'icons', 'icon-512.png'));
if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('icon-512.png is not a PNG');
const entry = Buffer.alloc(8);
entry.write('ic09', 0);
entry.writeUInt32BE(png.length + 8, 4);
const body = Buffer.concat([entry, png]);
const header = Buffer.alloc(8);
header.write('icns', 0);
header.writeUInt32BE(body.length + 8, 4);
const out = path.join(__dirname, '..', 'build', 'icon.icns');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, body]));
console.log('wrote ' + out + ' (' + (body.length + 8) + ' bytes)');
