#!/usr/bin/env node

import fs from 'node:fs';

const file = process.argv[2] ?? '/usr/lib/node_modules/@loro-dev/loro-cli/dist/cli.mjs';
const before = 'if (response.writableEnded) return;';
const after = 'if (response.headersSent || response.writableEnded) { response.destroy(); return; }';
const source = fs.readFileSync(file, 'utf8');

if (source.includes(after)) process.exit(0);
if (source.split(before).length !== 2) {
  throw new Error(`Refusing to patch unexpected @loro-dev/loro-cli source: ${file}`);
}

const backup = `${file}.before-lody-headers-sent-fix`;
if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
fs.writeFileSync(file, source.replace(before, after));
