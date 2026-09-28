import { describe, expect, it } from 'vitest';
import { ProfileStore, type KeyValueStore } from '../src/core/storage';
import {
  BONUS_MAX,
  BONUS_POOL,
  bonusRemaining,
  finalRatings,
  newProfile,
  overall,
  rating,
  RATING_CAP,
  setBonus,
  setPositions,
  validate,
  type PlayerProfile,
} from '../src/sim/profile';

const named = (p: PlayerProfile) => ({ ...p, firstName: 'Jamie', lastName: 'Rivera' });

function memStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('player profile', () => {
  it('a new named player is valid', () => {
    expect(validate(named(newProfile('a')))).toEqual([]);
    expect(validate(newProfile('a')).length).toBeGreaterThan(0);
  });

  it('bonus points respect the pool, the per-rating max and the cap', () => {
    let p = named(newProfile('a'));
    p = setBonus(p, 'power', 50);
    expect(p.bonus.power).toBe(BONUS_MAX);
    // Only 15 points: the second max-out gets what's left.
    p = setBonus(p, 'contact', BONUS_MAX);
    expect(p.bonus.contact).toBe(BONUS_POOL - BONUS_MAX);
    expect(bonusRemaining(p)).toBe(0);
    p = setBonus(p, 'eye', 5);
    expect(p.bonus.eye).toBe(0);
    for (const k of ['contact', 'power', 'eye'] as const) expect(rating(p, k)).toBeLessThanOrEqual(RATING_CAP);
  });

  it('pitching bonuses do nothing for a pure hitter', () => {
    const p = setBonus(named(newProfile('a')), 'velocity', 5);
    expect(p.bonus.velocity ?? 0).toBe(0);
  });

  it('two-way players must pitch and have both archetypes', () => {
    const tw = setPositions(named(newProfile('a')), 'P', 'CF');
    expect(tw.pitchArchetype).not.toBeNull();
    expect(tw.hitArchetype).not.toBeNull();
    expect(validate(tw)).toEqual([]);
    expect(validate({ ...tw, primary: 'LF', secondary: 'CF' }).length).toBeGreaterThan(0);
  });

  it('two-way players pay a small penalty in both halves of their game', () => {
    const hitter = named(newProfile('a'));
    const tw = setPositions(hitter, 'CF', 'P');
    expect(rating(tw, 'contact')).toBeLessThan(rating(hitter, 'contact'));
  });

  it('switching to pitcher only drops hitting bonuses', () => {
    let p = setBonus(named(newProfile('a')), 'power', 5);
    p = setPositions(p, 'P', null);
    expect(p.bonus.power).toBeUndefined();
    expect(p.hitArchetype).toBeNull();
    expect(finalRatings(p).batting.contact).toBeLessThan(40);
  });

  it('overall reflects the ratings', () => {
    const base = named(newProfile('a'));
    const boosted = setBonus(setBonus(base, 'contact', 8), 'power', 7);
    expect(overall(boosted)).toBeGreaterThan(overall(base));
    expect(overall(base)).toBeGreaterThan(50);
    expect(overall(base)).toBeLessThan(85);
  });
});

describe('save slots', () => {
  it('saves, loads, lists and deletes players', () => {
    const store = new ProfileStore(memStore());
    expect(store.active()).toBeNull();
    const p = named(newProfile('a'));
    store.save(1, p);
    expect(store.load(1)?.lastName).toBe('Rivera');
    expect(store.active()?.slot).toBe(1);
    expect(store.firstEmpty()).toBe(0);
    store.setActive(1);
    store.remove(1);
    expect(store.load(1)).toBeNull();
    expect(store.activeSlot()).toBeNull();
  });

  it('ignores corrupt data', () => {
    const kv = memStore();
    kv.setItem('baseball-legacy:slot:0', '{not json');
    kv.setItem('baseball-legacy:slot:1', JSON.stringify({ hello: 'world' }));
    const store = new ProfileStore(kv);
    expect(store.load(0)).toBeNull();
    expect(store.load(1)).toBeNull();
  });
});
