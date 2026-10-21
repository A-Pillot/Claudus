#!/usr/bin/env node
/** Usage: npm run sdf -- <model.dat> [out.sdf]   Prints (or writes) the suspension derivative listing. */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readDat } from './io/dat.js';
import { analyse } from './results/derivatives.js';
import { formatSdf } from './results/sdf.js';

const [file, out] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run sdf -- <model.dat> [out.sdf]');
  process.exit(1);
}
const model = readDat(readFileSync(file, 'utf8'));
const text = formatSdf(model, analyse(model), basename(file));
if (out) writeFileSync(out, text);
else process.stdout.write(text);
