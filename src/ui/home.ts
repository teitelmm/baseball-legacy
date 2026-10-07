import { DIFFICULTIES, type DifficultyName } from '../core/constants';
import { ProfileStore, SLOT_COUNT } from '../core/storage';
import type { Handedness } from '../core/types';
import type { GameSetupOptions } from '../modes/gameSession';
import type { PracticeOptions } from '../modes/practiceHost';
import {
  BAT_COLORS,
  bonusCap,
  bonusRemaining,
  BONUS_POOL,
  displayName,
  GLOVE_COLORS,
  HAIR_COLORS,
  HIT_ARCHETYPES,
  hittingSpot,
  HITTING_SPOTS,
  isHitter,
  isPitcher,
  isTwoWay,
  newProfile,
  overall,
  PITCH_ARCHETYPES,
  positionLabel,
  rating,
  RATING_LABEL,
  relevantKeys,
  setBonus,
  setPositions,
  SKIN_TONES,
  trimBonus,
  validate,
  type HitArchetype,
  type PitchArchetype,
  type PlayerProfile,
} from '../sim/profile';
import { USER_TEAM_STYLE, type UserRole } from '../sim/team';
import { profileLook } from '../scene/actors';
import { upgradePanel } from './upgrades';
import type { PlayerPreview } from '../scene/preview';

const PREFS_KEY = 'baseball-legacy:prefs';

interface Prefs {
  difficulty: DifficultyName;
  cpuHand: Handedness | 'S';
  innings: number;
  home: boolean;
}

function loadPrefs(): Prefs {
  const d: Prefs = { difficulty: 'pro', cpuHand: 'S', innings: 3, home: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...d, ...JSON.parse(raw) } : d;
  } catch {
    return d;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

export function segmented<T extends string>(
  id: string,
  label: string,
  options: Array<[T, string]>,
  value: T,
  onChange: (v: T) => void,
  wide = false,
): HTMLElement {
  const wrap = h('div', { class: wide ? 'opt wide' : 'opt' });
  wrap.appendChild(h('label', { for: id }, label));
  const seg = h('div', { class: 'seg', id, role: 'radiogroup' });
  for (const [v, text] of options) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), 'data-v': v }, text);
    b.className = v === value ? 'sel' : '';
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => {
        x.classList.remove('sel');
        x.setAttribute('aria-checked', 'false');
      });
      b.classList.add('sel');
      b.setAttribute('aria-checked', 'true');
      onChange(v);
    });
    seg.appendChild(b);
  }
  wrap.appendChild(seg);
  return wrap;
}

function swatches(id: string, label: string, colors: string[], value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = h('div', { class: 'opt wide' });
  wrap.appendChild(h('label', { for: id }, label));
  const row = h('div', { class: 'swatches', id });
  for (const c of colors) {
    const b = h('button', { type: 'button', 'aria-label': c, style: `background:${c}`, 'data-v': c });
    if (c === value) b.classList.add('sel');
    b.addEventListener('click', () => {
      row.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      onChange(c);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
  return wrap;
}

function heightLabel(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

export interface HomeHandlers {
  practice: (opts: PracticeOptions, profile: PlayerProfile) => void;
  game: (opts: GameSetupOptions) => void;
  /** Current graphics quality, and changing it. */
  graphics: () => 'low' | 'medium' | 'high';
  setGraphics: (q: 'low' | 'medium' | 'high') => void;
  /** Open the season hub for this slot's player. */
  season: (slot: number, profile: PlayerProfile, difficulty: DifficultyName) => void;
  /** The active player changed (use their ratings). */
  profileChanged: (profile: PlayerProfile | null) => void;
}

type View = 'home' | 'create' | 'slots' | 'setup' | 'upgrade';

/** Home screen, player creator, save slots and game setup. */
export class Home {
  private el: HTMLElement;
  private prefs = loadPrefs();
  private slot: number | null = null;
  private profile: PlayerProfile | null = null;
  private draft: PlayerProfile | null = null;
  private draftSlot = 0;
  private view: View = 'home';
  private confirmDelete: number | null = null;
  private upgradeNote = '';

  constructor(
    parent: HTMLElement,
    private readonly handlers: HomeHandlers,
    private readonly store: ProfileStore,
    private readonly preview: PlayerPreview,
  ) {
    this.el = h('div', { class: 'overlay home' });
    parent.appendChild(this.el);
    const active = store.active();
    if (active) {
      this.slot = active.slot;
      this.profile = active.profile;
    }
    handlers.profileChanged(this.profile);
    this.render();
  }

  get activeProfile(): PlayerProfile | null {
    return this.profile;
  }

  /** The active player was changed elsewhere (season points, upgrades). */
  setProfile(p: PlayerProfile): void {
    this.profile = p;
    if (this.visible) this.render();
  }

  /** Award skill points to the active player (exhibition games) and save. */
  addSkillPoints(n: number): void {
    if (!this.profile || this.slot === null || n <= 0) return;
    this.profile = { ...this.profile, skillPoints: (this.profile.skillPoints ?? 0) + n };
    this.store.save(this.slot, this.profile);
  }

  /** How much of the screen the left panel covers (for framing the 3D preview). */
  get panelFraction(): number {
    return this.view === 'home' ? 0.42 : this.view === 'create' ? 0.5 : 0.45;
  }

  show(): void {
    this.view = 'home';
    this.el.style.display = '';
    this.render();
  }

  hide(): void {
    this.el.style.display = 'none';
    this.preview.show(false);
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  private setPref(p: Partial<Prefs>): void {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
  }

  private go(view: View): void {
    this.view = view;
    this.confirmDelete = null;
    this.render();
  }

  private updatePreview(p: PlayerProfile | null): void {
    if (!p) {
      this.preview.show(false);
      return;
    }
    this.preview.set(profileLook(p), USER_TEAM_STYLE.colors, p.bats, isHitter(p));
    this.preview.show(true);
  }

  private render(): void {
    this.el.className = `overlay home view-${this.view}`;
    this.el.innerHTML = '';
    const panel = h('div', { class: 'home-panel' });
    this.el.appendChild(panel);
    switch (this.view) {
      case 'home':
        this.renderHome(panel);
        this.updatePreview(this.profile);
        break;
      case 'create':
        this.renderCreator(panel);
        this.updatePreview(this.draft);
        break;
      case 'slots':
        this.renderSlots(panel);
        this.updatePreview(this.profile);
        break;
      case 'setup':
        this.renderSetup(panel);
        this.updatePreview(this.profile);
        break;
      case 'upgrade':
        this.renderUpgrade(panel);
        this.updatePreview(this.profile);
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Home

  private ratingBars(p: PlayerProfile): string {
    return `<div class="rating-bars">${relevantKeys(p)
      .map((k) => {
        const v = rating(p, k);
        return `<div class="rb"><span>${RATING_LABEL[k]}</span><i><i style="width:${v}%"></i></i><b>${v}</b></div>`;
      })
      .join('')}</div>`;
  }

  private archetypeLine(p: PlayerProfile): string {
    return [p.hitArchetype ? HIT_ARCHETYPES[p.hitArchetype].name : '', p.pitchArchetype ? PITCH_ARCHETYPES[p.pitchArchetype].name : '']
      .filter(Boolean)
      .join(' · ');
  }

  private renderHome(panel: HTMLElement): void {
    panel.appendChild(h('h1', { class: 'brand' }, 'BASEBALL <span>LEGACY</span>'));
    const p = this.profile;
    if (!p) {
      panel.appendChild(h('div', { class: 'sub' }, 'YOUR CAREER STARTS HERE'));
      panel.appendChild(
        h(
          'p',
          { class: 'lead' },
          'Create your player: pick a position (or go two-way), choose how you hit and pitch, and pick your look.',
        ),
      );
      const b = h('button', { class: 'big primary', type: 'button', 'data-a': 'create' }, 'Create your player');
      b.addEventListener('click', () => this.startCreate(this.store.firstEmpty() ?? 0, null));
      panel.appendChild(h('div', { class: 'actions' })).appendChild(b);
      return;
    }
    panel.appendChild(h('div', { class: 'sub' }, 'HOME'));
    const card = h('div', { class: 'player-card' });
    card.innerHTML = `
      <div class="pc-top">
        <div class="pc-num">${p.number}</div>
        <div class="pc-id">
          <div class="pc-name">${esc(p.firstName)} <b>${esc(p.lastName)}</b></div>
          <div class="pc-meta">${positionLabel(p)}${isTwoWay(p) ? ' · Two-way' : ''} · Bats ${p.bats} / Throws ${p.throws}</div>
          <div class="pc-meta">${esc(this.archetypeLine(p))}</div>
        </div>
        <div class="pc-ovr"><span>OVR</span>${overall(p)}</div>
      </div>
      ${this.ratingBars(p)}`;
    panel.appendChild(card);

    const actions = h('div', { class: 'home-actions' });
    const btn = (label: string, a: string, primary = false) => {
      const b = h('button', { class: `big${primary ? ' primary' : ''}`, type: 'button', 'data-a': a }, label);
      actions.appendChild(b);
      return b;
    };
    const hasSeason = this.slot !== null && this.store.loadSeason(this.slot) !== null;
    btn(hasSeason ? 'Continue Season' : 'Start Season', 'season', true).addEventListener('click', () =>
      this.handlers.season(this.slot ?? 0, p, this.prefs.difficulty),
    );
    btn(`Upgrades · ${p.skillPoints ?? 0} pts`, 'upgrades').addEventListener('click', () => this.go('upgrade'));
    btn('Exhibition Game', 'game').addEventListener('click', () => this.go('setup'));
    btn('Batting Practice', 'bp').addEventListener('click', () => this.practice('batting'));
    btn('Pitching Practice', 'pp').addEventListener('click', () => this.practice('pitching'));
    btn('Edit Player', 'edit').addEventListener('click', () => this.startCreate(this.slot ?? 0, p));
    btn('Change Player', 'slots').addEventListener('click', () => this.go('slots'));
    panel.appendChild(actions);

    const opts = h('div', { class: 'options' });
    opts.appendChild(
      segmented(
        'difficulty',
        'DIFFICULTY',
        (Object.keys(DIFFICULTIES) as DifficultyName[]).map((d) => [d, DIFFICULTIES[d].label]),
        this.prefs.difficulty,
        (v) => this.setPref({ difficulty: v }),
        true,
      ),
    );
    opts.appendChild(
      segmented('graphics', 'GRAPHICS', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], this.handlers.graphics(), (v) => this.handlers.setGraphics(v), true),
    );
    opts.appendChild(
      segmented('cpu-hand', 'CPU HAND (PRACTICE)', [['R', 'Right'], ['L', 'Left'], ['S', 'Mix']], this.prefs.cpuHand, (v) => this.setPref({ cpuHand: v }), true),
    );
    panel.appendChild(opts);
    panel.appendChild(
      h(
        'details',
        { class: 'controls-help' },
        `<summary>Controls</summary>
        <ul>
          <li><b>Hitting:</b> mouse aims the PCI · left-click swing · right-click/Shift+click power swing</li>
          <li><b>Pitching:</b> 1–5 pitch · mouse aims · click start, click power, click on the yellow line</li>
          <li><b>Fielding:</b> W A S D / arrows run · catch is automatic · 1 2 3 4 throw</li>
          <li><b>General:</b> Esc pause · \` tuning panel · Space continue</li>
        </ul>`,
      ),
    );
  }

  private practice(role: 'batting' | 'pitching'): void {
    const p = this.profile!;
    this.handlers.practice(
      {
        role,
        difficulty: this.prefs.difficulty,
        userHand: role === 'batting' ? p.bats : p.throws,
        cpuHand: this.prefs.cpuHand,
      },
      p,
    );
  }

  // -------------------------------------------------------------------------
  // Upgrades

  private renderUpgrade(panel: HTMLElement): void {
    const p = this.profile!;
    panel.appendChild(h('div', { class: 'sub' }, 'UPGRADES'));
    const head = h('div', { class: 'upgrade-head' });
    head.innerHTML = `<h2 class="setup-title">${esc(displayName(p))} · OVR ${overall(p)}</h2>
      <div class="sp-chip" title="Skill points to spend"><b>${p.skillPoints ?? 0}</b><span>skill points</span></div>`;
    panel.appendChild(head);
    if (this.upgradeNote) panel.appendChild(h('div', { class: 'season-banner', role: 'status' }, esc(this.upgradeNote)));
    panel.appendChild(
      upgradePanel(p, (next, k) => {
        this.profile = next;
        if (this.slot !== null) this.store.save(this.slot, next);
        this.handlers.profileChanged(next);
        this.upgradeNote = `${RATING_LABEL[k]} is now ${rating(next, k)}.`;
        this.render();
      }),
    );
    const actions = h('div', { class: 'actions' });
    const back = h('button', { class: 'big', type: 'button', 'data-a': 'upgrade-back' }, 'Back');
    back.addEventListener('click', () => {
      this.upgradeNote = '';
      this.go('home');
    });
    actions.appendChild(back);
    panel.appendChild(actions);
  }

  // -------------------------------------------------------------------------
  // Game setup

  private renderSetup(panel: HTMLElement): void {
    const p = this.profile!;
    panel.appendChild(h('div', { class: 'sub' }, 'PLAY A GAME'));
    panel.appendChild(h('h2', { class: 'setup-title' }, `${esc(displayName(p))} · ${positionLabel(p)}`));
    const opts = h('div', { class: 'options' });
    let today: 'pitch' | 'field' = isPitcher(p) && !isTwoWay(p) ? 'pitch' : 'field';
    if (isTwoWay(p)) {
      today = 'pitch';
      opts.appendChild(
        segmented(
          'today',
          'TODAY YOU',
          [
            ['pitch', 'Pitch + bat (DH)'],
            ['field', `Play ${hittingSpot(p)}`],
          ],
          today,
          (v) => (today = v),
          true,
        ),
      );
    }
    opts.appendChild(
      segmented(
        'setup-difficulty',
        'DIFFICULTY',
        (Object.keys(DIFFICULTIES) as DifficultyName[]).map((d) => [d, DIFFICULTIES[d].label]),
        this.prefs.difficulty,
        (v) => this.setPref({ difficulty: v }),
        true,
      ),
    );
    opts.appendChild(
      segmented('innings', 'INNINGS', [['3', '3'], ['6', '6'], ['9', '9']], String(this.prefs.innings) as '3' | '6' | '9', (v) =>
        this.setPref({ innings: Number(v) }),
      ),
    );
    opts.appendChild(
      segmented('side', 'YOUR TEAM', [['home', 'Home'], ['away', 'Away']], this.prefs.home ? 'home' : 'away', (v) => this.setPref({ home: v === 'home' })),
    );
    panel.appendChild(opts);
    const actions = h('div', { class: 'actions' });
    const start = h('button', { class: 'big primary', type: 'button', 'data-a': 'start' }, 'Play ball');
    start.addEventListener('click', () =>
      this.handlers.game({ profile: p, today, difficulty: this.prefs.difficulty, innings: this.prefs.innings, home: this.prefs.home }),
    );
    const back = h('button', { class: 'big', type: 'button' }, 'Back');
    back.addEventListener('click', () => this.go('home'));
    actions.append(start, back);
    panel.appendChild(actions);
  }

  // -------------------------------------------------------------------------
  // Save slots

  private renderSlots(panel: HTMLElement): void {
    panel.appendChild(h('div', { class: 'sub' }, 'YOUR PLAYERS'));
    const list = h('div', { class: 'slots' });
    const all = this.store.list();
    for (let i = 0; i < SLOT_COUNT; i++) {
      const p = all[i];
      const card = h('div', { class: `slot-card${i === this.slot ? ' active' : ''}` });
      if (p) {
        card.innerHTML = `<div class="slot-main"><b>${esc(p.firstName)} ${esc(p.lastName)}</b><span>#${p.number} · ${positionLabel(p)} · OVR ${overall(p)}</span></div>`;
        const row = h('div', { class: 'slot-actions' });
        if (this.confirmDelete === i) {
          row.appendChild(h('span', { class: 'confirm' }, 'Delete this player?'));
          const yes = h('button', { type: 'button', class: 'danger', 'data-a': `confirm-delete-${i}` }, 'Delete');
          yes.addEventListener('click', () => this.deleteSlot(i));
          const no = h('button', { type: 'button' }, 'Keep');
          no.addEventListener('click', () => {
            this.confirmDelete = null;
            this.render();
          });
          row.append(yes, no);
        } else {
          const use = h('button', { type: 'button', 'data-a': `use-${i}` }, i === this.slot ? 'Playing' : 'Play as');
          use.toggleAttribute('disabled', i === this.slot);
          use.addEventListener('click', () => this.useSlot(i));
          const del = h('button', { type: 'button', 'data-a': `delete-${i}` }, 'Delete');
          del.addEventListener('click', () => {
            this.confirmDelete = i;
            this.render();
          });
          row.append(use, del);
        }
        card.appendChild(row);
      } else {
        card.innerHTML = `<div class="slot-main"><b>Empty slot</b><span>Slot ${i + 1}</span></div>`;
        const create = h('button', { type: 'button', 'data-a': `create-${i}` }, 'Create player');
        create.addEventListener('click', () => this.startCreate(i, null));
        const row = h('div', { class: 'slot-actions' });
        row.appendChild(create);
        card.appendChild(row);
      }
      list.appendChild(card);
    }
    panel.appendChild(list);
    const back = h('button', { class: 'big', type: 'button' }, 'Back');
    back.addEventListener('click', () => this.go('home'));
    panel.appendChild(h('div', { class: 'actions' })).appendChild(back);
  }

  private useSlot(i: number): void {
    const p = this.store.load(i);
    if (!p) return;
    this.slot = i;
    this.profile = p;
    this.store.setActive(i);
    this.handlers.profileChanged(p);
    this.go('home');
  }

  private deleteSlot(i: number): void {
    this.store.remove(i);
    if (this.slot === i) {
      const next = this.store.active();
      this.slot = next?.slot ?? null;
      this.profile = next?.profile ?? null;
      if (next) this.store.setActive(next.slot);
      this.handlers.profileChanged(this.profile);
    }
    this.confirmDelete = null;
    this.render();
  }

  // -------------------------------------------------------------------------
  // Creator

  private startCreate(slot: number, existing: PlayerProfile | null): void {
    this.draftSlot = slot;
    this.draft = existing ? { ...existing, bonus: { ...existing.bonus }, appearance: { ...existing.appearance } } : newProfile(`p-${Date.now().toString(36)}`);
    this.go('create');
  }

  private patch(p: Partial<PlayerProfile>, rerender = false): void {
    this.draft = trimBonus({ ...this.draft!, ...p });
    this.updatePreview(this.draft);
    if (rerender) this.render();
    else this.refreshDerived();
  }

  private patchLook(a: Partial<PlayerProfile['appearance']>): void {
    this.patch({ appearance: { ...this.draft!.appearance, ...a } });
  }

  /** Update the parts of the creator that depend on ratings without rebuilding inputs. */
  private refreshDerived(): void {
    const d = this.draft!;
    const bonus = this.el.querySelector('.bonus-list');
    if (bonus) this.fillBonus(bonus as HTMLElement);
    const ovr = this.el.querySelector('.creator-ovr');
    if (ovr) ovr.textContent = String(overall(d));
    const errs = this.el.querySelector('.form-errors');
    if (errs) errs.innerHTML = '';
  }

  private fillBonus(list: HTMLElement): void {
    const d = this.draft!;
    list.innerHTML = '';
    const left = bonusRemaining(d);
    list.appendChild(h('div', { class: 'points-left' }, `<b>${left}</b> of ${BONUS_POOL} bonus points left`));
    for (const k of relevantKeys(d)) {
      const v = rating(d, k);
      const spent = d.bonus[k] ?? 0;
      const row = h('div', { class: 'bonus-row' });
      row.innerHTML = `<span>${RATING_LABEL[k]}</span><i class="bar"><i style="width:${v}%"></i><i class="bonus" style="left:${v - spent}%;width:${spent}%"></i></i><b>${v}</b>`;
      const minus = h('button', { type: 'button', 'aria-label': `Less ${RATING_LABEL[k]}`, 'data-a': `minus-${k}` }, '−');
      const plus = h('button', { type: 'button', 'aria-label': `More ${RATING_LABEL[k]}`, 'data-a': `plus-${k}` }, '+');
      minus.toggleAttribute('disabled', spent <= 0);
      plus.toggleAttribute('disabled', spent >= bonusCap(d, k));
      minus.addEventListener('click', () => {
        this.draft = setBonus(this.draft!, k, spent - 1);
        this.refreshDerived();
      });
      plus.addEventListener('click', () => {
        this.draft = setBonus(this.draft!, k, spent + 1);
        this.refreshDerived();
      });
      row.append(minus, plus);
      list.appendChild(row);
    }
  }

  private renderCreator(panel: HTMLElement): void {
    const d = this.draft!;
    panel.appendChild(h('div', { class: 'sub' }, this.store.load(this.draftSlot)?.id === d.id ? 'EDIT PLAYER' : 'CREATE YOUR PLAYER'));
    const head = h('div', { class: 'creator-head' });
    head.innerHTML = `<h2>${d.firstName || d.lastName ? esc(`${d.firstName} ${d.lastName}`) : 'New player'}</h2><div class="pc-ovr"><span>OVR</span><b class="creator-ovr">${overall(d)}</b></div>`;
    panel.appendChild(head);
    const form = h('form', { class: 'creator', novalidate: '' });
    form.addEventListener('submit', (e) => e.preventDefault());
    panel.appendChild(form);

    // 1. Identity
    const id = h('fieldset', {}, '<legend>Identity</legend>');
    const nameRow = h('div', { class: 'row3' });
    const input = (idAttr: string, label: string, value: string, attrs: Record<string, string>, on: (v: string) => void) => {
      const w = h('div', { class: 'opt' });
      w.appendChild(h('label', { for: idAttr }, label));
      const i = h('input', { id: idAttr, value, ...attrs });
      i.addEventListener('input', () => on(i.value));
      w.appendChild(i);
      return w;
    };
    nameRow.append(
      input('first-name', 'FIRST NAME', d.firstName, { maxlength: '16', autocomplete: 'off' }, (v) => {
        this.draft!.firstName = v;
        head.querySelector('h2')!.textContent = `${v} ${this.draft!.lastName}`.trim() || 'New player';
      }),
      input('last-name', 'LAST NAME', d.lastName, { maxlength: '16', autocomplete: 'off' }, (v) => {
        this.draft!.lastName = v;
        head.querySelector('h2')!.textContent = `${this.draft!.firstName} ${v}`.trim() || 'New player';
        this.updatePreview(this.draft);
      }),
      input('number', 'NUMBER', String(d.number), { type: 'number', min: '0', max: '99', inputmode: 'numeric' }, (v) => {
        const n = Math.max(0, Math.min(99, Math.round(Number(v) || 0)));
        this.draft!.number = n;
        this.updatePreview(this.draft);
      }),
    );
    id.appendChild(nameRow);
    form.appendChild(id);

    // 2. Position
    const pos = h('fieldset', {}, '<legend>Position</legend>');
    const twoWay = isTwoWay(d);
    const posValue = twoWay ? 'TW' : d.primary;
    pos.appendChild(
      segmented(
        'position',
        'POSITION',
        [
          ['LF', 'LF'],
          ['CF', 'CF'],
          ['RF', 'RF'],
          ['DH', 'DH'],
          ['P', 'P'],
          ['TW', 'Two-way'],
        ],
        posValue as UserRole | 'TW',
        (v) => {
          if (v === 'TW') this.draft = setPositions(this.draft!, 'P', hittingSpot(this.draft!) ?? 'CF');
          else this.draft = setPositions(this.draft!, v, null);
          this.patch({}, true);
        },
        true,
      ),
    );
    if (twoWay) {
      pos.appendChild(
        segmented('hit-spot', 'TWO-WAY: YOU PITCH AND PLAY', HITTING_SPOTS.map((s) => [s, s]), hittingSpot(d) ?? 'CF', (v) => {
          this.draft = setPositions(this.draft!, 'P', v);
          this.patch({}, true);
        }, true),
      );
      pos.appendChild(h('p', { class: 'hint-text' }, 'Two-way players pitch every so often and hit the rest of the time. Doing both costs a few points in each.'));
    }
    const hands = h('div', { class: 'row2' });
    hands.append(
      segmented('bats', 'BATS', [['R', 'Right'], ['L', 'Left']], d.bats, (v) => this.patch({ bats: v })),
      segmented('throws', 'THROWS', [['R', 'Right'], ['L', 'Left']], d.throws, (v) => this.patch({ throws: v })),
    );
    pos.appendChild(hands);
    form.appendChild(pos);

    // 3. Archetypes
    const arch = h('fieldset', {}, '<legend>Archetype</legend>');
    const cards = <K extends string>(title: string, defs: Record<K, { name: string; blurb: string }>, value: K | null, on: (k: K) => void) => {
      arch.appendChild(h('div', { class: 'arch-title' }, title));
      const grid = h('div', { class: 'arch-grid', role: 'radiogroup' });
      for (const k of Object.keys(defs) as K[]) {
        const b = h('button', { type: 'button', class: `arch${k === value ? ' sel' : ''}`, role: 'radio', 'aria-checked': String(k === value), 'data-arch': k });
        b.innerHTML = `<b>${defs[k].name}</b><span>${defs[k].blurb}</span>`;
        b.addEventListener('click', () => on(k));
        grid.appendChild(b);
      }
      arch.appendChild(grid);
    };
    if (isHitter(d)) cards<HitArchetype>('Hitting', HIT_ARCHETYPES, d.hitArchetype, (k) => this.patch({ hitArchetype: k }, true));
    if (isPitcher(d)) cards<PitchArchetype>('Pitching', PITCH_ARCHETYPES, d.pitchArchetype, (k) => this.patch({ pitchArchetype: k }, true));
    form.appendChild(arch);

    // 4. Bonus points
    const bonus = h('fieldset', {}, '<legend>Ratings</legend>');
    const list = h('div', { class: 'bonus-list' });
    this.fillBonus(list);
    bonus.appendChild(list);
    form.appendChild(bonus);

    // 5. Look
    const a = d.appearance;
    const look = h('fieldset', {}, '<legend>Look</legend>');
    look.appendChild(swatches('skin', 'SKIN TONE', SKIN_TONES, a.skin, (v) => this.patchLook({ skin: v })));
    look.appendChild(
      segmented(
        'hair',
        'HAIR',
        [
          ['none', 'Bald'],
          ['buzz', 'Buzz'],
          ['short', 'Short'],
          ['curly', 'Curly'],
          ['long', 'Long'],
        ],
        a.hair,
        (v) => this.patchLook({ hair: v }),
        true,
      ),
    );
    look.appendChild(swatches('hair-color', 'HAIR COLOR', HAIR_COLORS, a.hairColor, (v) => this.patchLook({ hairColor: v })));
    look.appendChild(
      segmented(
        'facial-hair',
        'FACIAL HAIR',
        [
          ['none', 'None'],
          ['stubble', 'Stubble'],
          ['mustache', 'Mustache'],
          ['goatee', 'Goatee'],
          ['beard', 'Beard'],
        ],
        a.facialHair,
        (v) => this.patchLook({ facialHair: v }),
        true,
      ),
    );
    look.appendChild(
      segmented(
        'build',
        'BUILD',
        [
          ['slim', 'Slim'],
          ['athletic', 'Athletic'],
          ['stocky', 'Stocky'],
        ],
        a.build,
        (v) => this.patchLook({ build: v }),
      ),
    );
    const hw = h('div', { class: 'opt' });
    hw.appendChild(h('label', { for: 'height' }, `HEIGHT <b class="height-val">${heightLabel(a.heightIn)}</b>`));
    const range = h('input', { id: 'height', type: 'range', min: '68', max: '78', step: '1', value: String(a.heightIn) });
    range.addEventListener('input', () => {
      hw.querySelector('.height-val')!.textContent = heightLabel(Number(range.value));
      this.patchLook({ heightIn: Number(range.value) });
    });
    hw.appendChild(range);
    look.appendChild(hw);
    look.appendChild(segmented('eye-black', 'EYE BLACK', [['no', 'No'], ['yes', 'Yes']], a.eyeBlack ? 'yes' : 'no', (v) => this.patchLook({ eyeBlack: v === 'yes' })));
    look.appendChild(swatches('bat-color', 'BAT', BAT_COLORS, a.batColor, (v) => this.patchLook({ batColor: v })));
    look.appendChild(swatches('glove-color', 'GLOVE', GLOVE_COLORS, a.gloveColor, (v) => this.patchLook({ gloveColor: v })));
    form.appendChild(look);

    // Save / cancel
    const errors = h('div', { class: 'form-errors', role: 'alert' });
    panel.appendChild(errors);
    const actions = h('div', { class: 'actions sticky-actions' });
    const save = h('button', { class: 'big primary', type: 'button', 'data-a': 'save' }, 'Save player');
    save.addEventListener('click', () => this.saveDraft(errors));
    const cancel = h('button', { class: 'big', type: 'button', 'data-a': 'cancel' }, 'Cancel');
    cancel.addEventListener('click', () => {
      this.draft = null;
      this.go(this.profile ? 'home' : 'home');
    });
    actions.append(save, cancel);
    panel.appendChild(actions);
  }

  private saveDraft(errorsEl: HTMLElement): void {
    const d = { ...this.draft!, firstName: this.draft!.firstName.trim(), lastName: this.draft!.lastName.trim() };
    const errs = validate(d);
    if (errs.length) {
      errorsEl.innerHTML = errs.map((e) => `<div>${esc(e)}</div>`).join('');
      return;
    }
    this.store.save(this.draftSlot, d);
    this.store.setActive(this.draftSlot);
    this.slot = this.draftSlot;
    this.profile = d;
    this.draft = null;
    this.handlers.profileChanged(d);
    this.go('home');
  }
}
