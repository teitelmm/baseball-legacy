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

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.scorebug = el('div', 'panel scorebug', this.root);
    this.matchup = el('div', 'panel matchup', this.root);
    this.stats = el('div', 'panel stats', this.root);
    this.log = el('div', 'panel pitchlog', this.root);
    this.fb = el('div', 'feedback', this.root);
    this.fbTitle = el('div', 'fb-title', this.fb);
    this.fbDetail = el('div', 'fb-detail', this.fb);
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

  update(s: GameState, role: 'batting' | 'pitching'): void {
    const b = s.bases;
    this.scorebug.innerHTML = `
      <div class="sb-inning"><span class="lbl">INN</span>${s.inning}</div>
      <div class="sb-bases">
        <svg viewBox="0 0 40 30" width="44" height="33">
          <rect x="16" y="2" width="9" height="9" transform="rotate(45 20.5 6.5)" class="${b[1] ? 'on' : ''}"/>
          <rect x="27" y="13" width="9" height="9" transform="rotate(45 31.5 17.5)" class="${b[0] ? 'on' : ''}"/>
          <rect x="5" y="13" width="9" height="9" transform="rotate(45 9.5 17.5)" class="${b[2] ? 'on' : ''}"/>
        </svg>
      </div>
      <div class="sb-count">
        <div><span class="lbl">B</span>${dots(s.count.balls, 3, 'ball')}</div>
        <div><span class="lbl">S</span>${dots(s.count.strikes, 2, 'strike')}</div>
        <div><span class="lbl">O</span>${dots(Math.min(s.outs, 2), 2, 'out')}</div>
      </div>
      <div class="sb-runs"><span class="lbl">RUNS</span>${s.runs}</div>`;

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
