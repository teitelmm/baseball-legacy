import { sanitize, type PlayerProfile } from '../sim/profile';

export const SLOT_COUNT = 3;
const SLOT_KEY = (i: number) => `baseball-legacy:slot:${i}`;
const ACTIVE_KEY = 'baseball-legacy:active-slot';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage, or a no-op store when it's unavailable (private mode, blocked, previews). */
export function browserStore(): KeyValueStore {
  try {
    const s = window.localStorage;
    const probe = '__bl_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}

/** Three save slots for your players. */
export class ProfileStore {
  constructor(private readonly store: KeyValueStore = browserStore()) {}

  load(slot: number): PlayerProfile | null {
    try {
      const raw = this.store.getItem(SLOT_KEY(slot));
      return raw ? sanitize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  save(slot: number, p: PlayerProfile): boolean {
    try {
      this.store.setItem(SLOT_KEY(slot), JSON.stringify(p));
      return true;
    } catch {
      return false;
    }
  }

  remove(slot: number): void {
    try {
      this.store.removeItem(SLOT_KEY(slot));
      if (this.activeSlot() === slot) this.store.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
  }

  list(): Array<PlayerProfile | null> {
    return Array.from({ length: SLOT_COUNT }, (_, i) => this.load(i));
  }

  activeSlot(): number | null {
    try {
      const v = Number(this.store.getItem(ACTIVE_KEY));
      return this.store.getItem(ACTIVE_KEY) !== null && v >= 0 && v < SLOT_COUNT ? v : null;
    } catch {
      return null;
    }
  }

  setActive(slot: number): void {
    try {
      this.store.setItem(ACTIVE_KEY, String(slot));
    } catch {
      /* ignore */
    }
  }

  /** The active player, falling back to the first filled slot. */
  active(): { slot: number; profile: PlayerProfile } | null {
    const a = this.activeSlot();
    if (a !== null) {
      const p = this.load(a);
      if (p) return { slot: a, profile: p };
    }
    const all = this.list();
    const i = all.findIndex((p) => p);
    return i >= 0 ? { slot: i, profile: all[i]! } : null;
  }

  firstEmpty(): number | null {
    const i = this.list().findIndex((p) => !p);
    return i >= 0 ? i : null;
  }
}
