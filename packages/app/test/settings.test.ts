import { describe, expect, it } from 'vitest';
import { defaultSettings, pushRecent, sanitiseSettings } from '../src/settings';

describe('settings', () => {
  it('falls back to defaults for bad stored values', () => {
    expect(sanitiseSettings(null)).toEqual(defaultSettings());
    const s = sanitiseSettings({ markerSize: 99, textSize: 'x', decimals: 2.6, scopeSymbol: 'star', style: { scope: { colour: 'red', marker: 'plus' }, user: { colour: '#112233', marker: 'plus' } } });
    expect(s.markerSize).toBe(12);
    expect(s.textSize).toBe(10);
    expect(s.decimals).toBe(3);
    expect(s.scopeSymbol).toBe('star');
    expect(s.style.scope).toEqual(defaultSettings().style.scope);
    expect(s.style.user).toEqual({ colour: '#112233', marker: 'plus' });
  });

  it('keeps the last five files, newest first, without duplicates', () => {
    let list = pushRecent([], { name: 'a.dat', text: 'A' });
    for (const n of ['b', 'c', 'd', 'e', 'f']) list = pushRecent(list, { name: n + '.dat', text: n });
    expect(list.map((r) => r.name)).toEqual(['f.dat', 'e.dat', 'd.dat', 'c.dat', 'b.dat']);
    list = pushRecent(list, { name: 'c.dat', text: 'C2' });
    expect(list.map((r) => r.name)).toEqual(['c.dat', 'f.dat', 'e.dat', 'd.dat', 'b.dat']);
    expect(list[0].text).toBe('C2');
  });

  it('lists a very large file by name only', () => {
    const list = pushRecent([], { name: 'big.dat', text: 'x'.repeat(400_000) });
    expect(list[0]).toEqual({ name: 'big.dat' });
  });
});
