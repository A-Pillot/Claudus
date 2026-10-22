import { describe, expect, it } from 'vitest';
import { readDat, writeDat } from '../src/io/dat.js';
import { MODEL_ACCEPT, acceptExtensions, isModelFileName, modelBaseName, modelExtension, withModelExtension } from '../src/io/modelFile.js';
import { sample } from './helpers.js';

describe('.shk model files', () => {
  it('treats .dat and .shk alike, in any case', () => {
    expect(isModelFileName('car.dat')).toBe(true);
    expect(isModelFileName('car.SHK')).toBe(true);
    expect(isModelFileName('car.txt')).toBe(false);
    expect(modelExtension('Front.Shk')).toBe('.shk');
    expect(modelExtension('front.dat')).toBe('.dat');
    expect(modelExtension('front.sdf')).toBeNull();
  });

  it('names files from a model file name', () => {
    expect(modelBaseName('car.shk')).toBe('car');
    expect(modelBaseName('car_2d.shk', true)).toBe('car');
    expect(withModelExtension('car.dat', '.shk')).toBe('car.shk');
    expect(withModelExtension('car', '.dat')).toBe('car.dat');
  });

  it('splits accept strings into extensions', () => {
    expect(acceptExtensions(MODEL_ACCEPT)).toEqual(['dat', 'shk']);
    expect(acceptExtensions('.dat, .tpl,.txt')).toEqual(['dat', 'tpl', 'txt']);
  });

  it('a model saved as .shk reads back the same (one text format for both)', () => {
    const m = readDat(sample('type1.dat'));
    const shk = writeDat(m); // what Save writes under a .shk name
    expect(readDat(shk)).toEqual(m);
  });
});
