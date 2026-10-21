import { describe, expect, it } from 'vitest';
import {
  defaultUnits, fromDisplay, fromDisplayUnit, normalizeUnits, presetSetting, toDisplay, toDisplayUnit, unitDecimals,
  unitDecimalsFor, unitFactor, unitText, type UnitSettings,
} from '../src/units.js';

const withSet = (over: Partial<UnitSettings>): UnitSettings => ({ ...defaultUnits(), ...over });

describe('display units', () => {
  it('leaves values alone in the default units', () => {
    const d = defaultUnits();
    expect(toDisplay('angle', 2.5, d)).toBe(2.5);
    expect(toDisplay('length', 100, d)).toBe(100);
    expect(unitText('N/mm', d)).toBe('N/mm');
    expect(unitText('°', d)).toBe('°');
  });

  it('converts angle, length and force presets and back', () => {
    const s = withSet({ angle: presetSetting('angle', 'rad'), length: presetSetting('length', 'm'), force: presetSetting('force', 'daN') });
    expect(toDisplay('angle', 180, s)).toBeCloseTo(Math.PI, 12);
    expect(fromDisplay('angle', Math.PI, s)).toBeCloseTo(180, 10);
    expect(toDisplay('length', 250, s)).toBeCloseTo(0.25, 12);
    expect(toDisplay('force', 1000, s)).toBe(100);
    expect(toDisplay('angle', 1, withSet({ angle: presetSetting('angle', 'min') }))).toBe(60);
    expect(toDisplay('angle', 1, withSet({ angle: presetSetting('angle', 'mrad') }))).toBeCloseTo(17.4533, 3);
  });

  it('converts compound units by numerator and denominator', () => {
    const s = withSet({ angle: presetSetting('angle', 'rad'), length: presetSetting('length', 'm'), force: presetSetting('force', 'daN') });
    expect(unitText('deg/mm', s)).toBe('rad/m');
    expect(unitFactor('deg/mm', s)).toBeCloseTo((Math.PI / 180) / 0.001, 10);
    expect(unitText('N/mm', s)).toBe('daN/m');
    expect(toDisplayUnit('N/mm', 50, s)).toBeCloseTo((50 * 0.1) / 0.001, 8);
    expect(fromDisplayUnit('N/mm', toDisplayUnit('N/mm', 50, s), s)).toBeCloseTo(50, 10);
    expect(unitText('N·mm/deg', s)).toBe('daN·m/rad');
  });

  it('does not touch %, Hz, s or empty units', () => {
    const s = withSet({ angle: presetSetting('angle', 'rad'), length: presetSetting('length', 'm') });
    for (const u of ['%', 'Hz', 's', '']) {
      expect(unitFactor(u, s)).toBe(1);
      expect(unitText(u, s)).toBe(u);
    }
  });

  it('handles user-defined units and decimals', () => {
    const s = withSet({ length: { preset: 'user', scale: 1 / 25.4, label: 'in', extra: 1 } });
    expect(toDisplay('length', 25.4, s)).toBeCloseTo(1, 12);
    expect(unitText('mm', s)).toBe('in');
    expect(unitDecimals('length', 2, s)).toBe(3);
    expect(unitDecimals('length', 0, withSet({ length: { preset: 'user', scale: 1, label: 'x', extra: -2 } }))).toBe(0);
    expect(unitDecimalsFor('deg/mm', 3, withSet({ angle: presetSetting('angle', 'rad'), length: presetSetting('length', 'm') }))).toBe(3);
  });

  it('normalises bad saved settings to defaults', () => {
    expect(normalizeUnits(null)).toEqual(defaultUnits());
    expect(normalizeUnits({ angle: { preset: 'bogus' }, length: { preset: 'user', scale: -1, label: 'x' } })).toEqual(defaultUnits());
    expect(normalizeUnits({ length: { preset: 'm' } }).length.scale).toBe(0.001);
    expect(normalizeUnits({ mass: { preset: 'user', scale: 2.2046, label: 'lb', extra: 1 } }).mass.label).toBe('lb');
  });
});
