import type { GameState } from '../sim/atBat';
import { battingAverage, inningsPitched } from '../sim/atBat';
import { LATE_LIMIT, MAX_POWER } from '../sim/pitchMeter';

export type Tone = 'good' | 'bad' | 'neutral' | 'big';

export interface PitchMenuItem {
  id: string;
  key: string;
  name: string;
  mph: number;
  color: string;
}

export interface GameHudInfo {
  awayAbbr: string;
  homeAbbr: string;
  awayRuns: number;
  homeRuns: number;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  count: { balls: number; strikes: number };
  bases: GameState['bases'];
  userName: string;
  userPos: string;
  userLine: string;
  /** 0..1 when you're pitching, else null. */
  stamina: number | null;
  pitches: number;
}

export interface PitchLogEntry {
  n: number;
  name: string;
  mph: number;
  call: string;
  color: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

const dots = (n: number, of: number, cls: string) =>
  Array.from({ length: of }, (_, i) => `<i class="dot ${cls} ${i < n ? 'on' : ''}"></i>`).join('');

export class Hud {
  readonly root: HTMLElement;
  private scorebug: HTMLElement;
  private stats: HTMLElement;
  private fbTitle: HTMLElement;
  private fbDetail: HTMLElement;
  private fb: HTMLElement;
  private log: HTMLElement;
  private pitchMenu: HTMLElement;
  private meterEl: HTMLElement;
  private meterFill: HTMLElement;
  private meterPower: HTMLElement;
  private hintEl: HTMLElement;
  private matchup: HTMLElement;
  private fbTimer = 0;
  private flashEl: HTMLElement;
  private flashTimer = 0;
  private timingEl: HTMLElement;
  private timingTick: HTMLElement;
  private timingZones: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.scorebug = el('div', 'panel scorebug', this.root);
    this.matchup = el('div', 'panel matchup', this.root);
    this.stats = el('div', 'panel stats', this.root);
    this.log = el('div', 'panel pitchlog', this.root);
    this.fb = el('div', 'feedback', this.root);
    this.fbTitle = el('div', 'fb-title', this.fb);
    this.fbDetail = el('div', 'fb-detail', this.fb);
    this.timingEl = el('div', 'timing', this.fb);
    el('span', 'tm-label', this.timingEl).textContent = 'EARLY';
    const bar = el('div', 'tm-bar', this.timingEl);
    this.timingZones = el('div', 'tm-zones', bar);
    this.timingTick = el('div', 'tm-tick', bar);
    el('span', 'tm-label', this.timingEl).textContent = 'LATE';
    this.timingEl.style.display = 'none';
    this.flashEl = el('div', 'flash', this.root);
    this.pitchMenu = el('div', 'pitchmenu', this.root);
    this.meterEl = el('div', 'meter', this.root);
    const track = el('div', 'meter-track', this.meterEl);
    const range = MAX_POWER - LATE_LIMIT;
    const zeroPct = (-LATE_LIMIT / range) * 100;
    const onePct = ((1 - LATE_LIMIT) / range) * 100;
    el('div', 'meter-effort', track).style.bottom = `${onePct}%`;
    const line = el('div', 'meter-line', track);
    line.style.bottom = `${zeroPct}%`;
    this.meterFill = el('div', 'meter-fill', track);
    this.meterPower = el('div', 'meter-power', track);
    el('div', 'meter-label', this.meterEl).textContent = 'POWER';
    this.hintEl = el('div', 'hint', this.root);
    this.hide();
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private scorebugHtml(bases: GameState['bases'], count: { balls: number; strikes: number }, outs: number, left: string, right: string): string {
    const b = bases;
    return `
      ${left}
      <div class="sb-bases">
        <svg viewBox="0 0 40 30" width="44" height="33">
          <rect x="16" y="2" width="9" height="9" transform="rotate(45 20.5 6.5)" class="${b[1] ? 'on' : ''}"/>
          <rect x="27" y="13" width="9" height="9" transform="rotate(45 31.5 17.5)" class="${b[0] ? 'on' : ''}"/>
          <rect x="5" y="13" width="9" height="9" transform="rotate(45 9.5 17.5)" class="${b[2] ? 'on' : ''}"/>
        </svg>
      </div>
      <div class="sb-count">
        <div><span class="lbl">B</span>${dots(count.balls, 3, 'ball')}</div>
        <div><span class="lbl">S</span>${dots(count.strikes, 2, 'strike')}</div>
        <div><span class="lbl">O</span>${dots(Math.min(outs, 2), 2, 'out')}</div>
      </div>
      ${right}`;
  }

  /** Scorebug + your line during a real game. */
  updateGame(g: GameHudInfo): void {
    const left = `<div class="sb-teams">
        <div class="${g.half === 'top' ? 'bat' : ''}"><span>${g.awayAbbr}</span><b>${g.awayRuns}</b></div>
        <div class="${g.half === 'bottom' ? 'bat' : ''}"><span>${g.homeAbbr}</span><b>${g.homeRuns}</b></div>
      </div>
      <div class="sb-inning">${g.half === 'top' ? '▲' : '▼'}${g.inning}</div>`;
    this.scorebug.innerHTML = this.scorebugHtml(g.bases, g.count, g.outs, left, '');
    const stamina =
      g.stamina === null
        ? ''
        : `<span>STAMINA</span><b><i class="stamina"><i style="width:${Math.round(g.stamina * 100)}%"></i></i></b><span>PITCHES</span><b>${g.pitches}</b>`;
    this.stats.innerHTML = `
      <div class="st-title">${g.userName.toUpperCase()} · ${g.userPos}</div>
      <div class="st-grid">
        <span>TODAY</span><b>${g.userLine || '—'}</b>
        ${stamina}
      </div>`;
  }

  update(s: GameState, role: 'batting' | 'pitching'): void {
    this.scorebug.innerHTML = this.scorebugHtml(
      s.bases,
      s.count,
      s.outs,
      `<div class="sb-inning"><span class="lbl">INN</span>${s.inning}</div>`,
      `<div class="sb-runs"><span class="lbl">RUNS</span>${s.runs}</div>`,
    );

    if (role === 'batting') {
      const l = s.batting;
      this.stats.innerHTML = `
        <div class="st-title">YOUR BATTING</div>
        <div class="st-grid">
          <span>AVG</span><b>${battingAverage(l)}</b>
          <span>H-AB</span><b>${l.h}-${l.ab}</b>
          <span>HR</span><b>${l.hr}</b>
          <span>RBI</span><b>${l.rbi}</b>
          <span>BB</span><b>${l.bb}</b>
          <span>K</span><b>${l.k}</b>
          <span>MAX EV</span><b>${l.maxEv ? l.maxEv.toFixed(1) : '—'}</b>
        </div>`;
    } else {
      const l = s.pitching;
      const strikePct = l.pitches ? Math.round((l.strikes / l.pitches) * 100) : 0;
      this.stats.innerHTML = `
        <div class="st-title">YOUR PITCHING</div>
        <div class="st-grid">
          <span>IP</span><b>${inningsPitched(l)}</b>
          <span>PITCHES</span><b>${l.pitches}</b>
          <span>STRIKE%</span><b>${strikePct}%</b>
          <span>K</span><b>${l.k}</b>
          <span>BB</span><b>${l.bb}</b>
          <span>H</span><b>${l.h}</b>
          <span>R</span><b>${l.r}</b>
        </div>`;
    }
  }

  setMatchup(pitcher: string, batter: string): void {
    this.matchup.innerHTML = `<div><span class="lbl">P</span>${pitcher}</div><div><span class="lbl">AB</span>${batter}</div>`;
  }

  feedback(title: string, detail = '', tone: Tone = 'neutral', ms = 2200): void {
    this.fbTitle.textContent = title;
    this.fbDetail.innerHTML = detail;
    this.fb.className = `feedback show ${tone}`;
    window.clearTimeout(this.fbTimer);
    this.fbTimer = window.setTimeout(() => (this.fb.className = `feedback ${tone}`), ms);
  }

  /**
   * Show where a swing landed on an Early / Perfect / Late bar. Pass null to hide.
   * Windows are the half-widths in ms for the current difficulty.
   */
  setTiming(dtMs: number | null, w?: { perfect: number; good: number; ok: number; whiff: number }): void {
    if (dtMs === null || !w) {
      this.timingEl.style.display = 'none';
      return;
    }
    this.timingEl.style.display = '';
    const span = w.whiff * 1.15;
    const pct = (ms: number) => 50 + (ms / span) * 50;
    const band = (half: number, cls: string) => `<i class="${cls}" style="left:${pct(-half)}%;width:${pct(half) - pct(-half)}%"></i>`;
    this.timingZones.innerHTML = band(w.whiff, 'z-whiff') + band(w.ok, 'z-ok') + band(w.good, 'z-good') + band(w.perfect, 'z-perfect');
    this.timingTick.style.left = `${Math.min(100, Math.max(0, pct(dtMs)))}%`;
  }

  /** Short call-out during a play ("Out at first", "Scores!"). */
  flash(text: string): void {
    this.flashEl.textContent = text;
    this.flashEl.classList.add('show');
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.flashEl.classList.remove('show'), 1400);
  }

  clearFeedback(): void {
    window.clearTimeout(this.fbTimer);
    this.fb.className = 'feedback';
  }

  setLog(entries: PitchLogEntry[]): void {
    if (!entries.length) {
      this.log.style.display = 'none';
      return;
    }
    this.log.style.display = '';
    this.log.innerHTML =
      `<div class="st-title">THIS AT-BAT</div>` +
      entries
        .map(
          (e) =>
            `<div class="log-row"><i class="swatch" style="background:${e.color}"></i><span class="n">${e.n}</span><span class="nm">${e.name}</span><b>${e.mph.toFixed(1)}</b><span class="call">${e.call}</span></div>`,
        )
        .join('');
  }

  setPitchMenu(items: PitchMenuItem[] | null, selected: string | null, onSelect?: (id: string) => void): void {
    if (!items) {
      this.pitchMenu.style.display = 'none';
      return;
    }
    this.pitchMenu.style.display = '';
    this.pitchMenu.innerHTML = '';
    for (const it of items) {
      const b = el('button', `pm-btn ${it.id === selected ? 'sel' : ''}`, this.pitchMenu);
      b.innerHTML = `<kbd>${it.key}</kbd><i class="swatch" style="background:${it.color}"></i><span>${it.name}</span><b>${it.mph.toFixed(0)}</b>`;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        onSelect?.(it.id);
      });
    }
  }

  /** value/power in meter units; pass null to hide. */
  setMeter(value: number | null, power: number | null): void {
    if (value === null) {
      this.meterEl.style.display = 'none';
      return;
    }
    this.meterEl.style.display = '';
    const range = MAX_POWER - LATE_LIMIT;
    const zero = -LATE_LIMIT / range;
    const pct = (v: number) => ((v - LATE_LIMIT) / range) * 100;
    const bottom = Math.min(pct(value), zero * 100);
    const top = Math.max(pct(value), zero * 100);
    this.meterFill.style.bottom = `${bottom}%`;
    this.meterFill.style.height = `${top - bottom}%`;
    this.meterFill.classList.toggle('effort', value > 1);
    if (power === null) {
      this.meterPower.style.display = 'none';
    } else {
      this.meterPower.style.display = '';
      this.meterPower.style.bottom = `${pct(power)}%`;
    }
  }

  hint(html: string): void {
    this.hintEl.innerHTML = html;
  }
}
