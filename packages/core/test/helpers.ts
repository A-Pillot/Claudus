import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readDat } from '../src/io/dat.js';

/** Sample models live next to the tests so the suite runs anywhere. */
export const SAMPLES = join(__dirname, 'samples');
export const sample = (name: string) => readFileSync(join(SAMPLES, name), 'utf8');
export const sampleModel = (name: string) => readDat(sample(name));
export const hasSample = (name: string) => existsSync(join(SAMPLES, name));
