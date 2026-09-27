import type { DifficultyName } from '../core/constants';
import { DIFFICULTIES } from '../core/constants';
import type { Handedness } from '../core/types';
import type { Role, SessionOptions } from '../modes/session';

const STORAGE_KEY = 'baseball-legacy:practice-options';

interface MenuPrefs {
  difficulty: DifficultyName;
  bats: Handedness;
  throws: Handedness;
  cpuHand: Handedness | 'S';
}

function loadPrefs(): MenuPrefs {
  const defaults: MenuPrefs = { difficulty: 'pro', bats: 'R', throws: 'R', cpuHand: 'S' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

function savePrefs(p: MenuPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

function segmented<T extends string>(
  label: string,
  options: Array<[T, string]>,
  value: T,
  onChange: (v: T) => void,
  wide = false,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = wide ? 'opt wide' : 'opt';
  const l = document.createElement('label');
  l.textContent = label;
  wrap.appendChild(l);
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const [v, text] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.className = v === value ? 'sel' : '';
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      onChange(v);
    });
    seg.appendChild(b);
  }
  wrap.appendChild(seg);
  return wrap;
}

/** Stage 1 placeholder menu: pick a practice mode and options. */
export class Menu {
  private el: HTMLElement;
  private prefs = loadPrefs();

  constructor(parent: HTMLElement, onStart: (opts: SessionOptions) => void) {
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    this.el.innerHTML = `
      <div class="menu">
        <h1>BASEBALL <span>LEGACY</span></h1>
        <div class="sub">STAGE 1 · HITTING &amp; PITCHING PRACTICE</div>
        <div class="modes">
          <button class="mode-card" data-role="batting">
            <h2>Batting Practice</h2>
            <p>Step in against a CPU pitcher. Aim the PCI, time your swing, and drive the ball.</p>
          </button>
          <button class="mode-card" data-role="pitching">
            <h2>Pitching Practice</h2>
            <p>Take the mound against CPU hitters. Pick a pitch, hit your spot, and work the count.</p>
          </button>
        </div>
        <div class="options"></div>
        <div class="controls">
          <div>
            <h3>HITTING</h3>
            <ul>
              <li><kbd>Mouse</kbd> moves the PCI (contact cursor)</li>
              <li><kbd>Left-click</kbd> normal swing</li>
              <li><kbd>Right-click</kbd> or <kbd>Shift+click</kbd> power swing</li>
              <li>Early = pull · Late = opposite field</li>
              <li>PCI above the ball = grounder · below = fly ball</li>
            </ul>
          </div>
          <div>
            <h3>PITCHING</h3>
            <ul>
              <li><kbd>1–5</kbd> or click to choose a pitch</li>
              <li><kbd>Mouse</kbd> aims the target</li>
              <li><kbd>Click</kbd> start meter · <kbd>Click</kbd> set power</li>
              <li><kbd>Click</kbd> again on the yellow line for accuracy</li>
              <li>Red zone = max effort: faster, but wilder</li>
            </ul>
          </div>
          <div>
            <h3>GENERAL</h3>
            <ul>
              <li><kbd>Esc</kbd> pause / menu</li>
              <li><kbd>\`</kbd> debug &amp; tuning panel</li>
              <li><kbd>Space</kbd> skip the replay</li>
            </ul>
          </div>
        </div>
      </div>`;
    parent.appendChild(this.el);

    const opts = this.el.querySelector('.options')!;
    opts.appendChild(
      segmented(
        'DIFFICULTY',
        (Object.keys(DIFFICULTIES) as DifficultyName[]).map((d) => [d, DIFFICULTIES[d].label]),
        this.prefs.difficulty,
        (v) => this.set({ difficulty: v }),
        true,
      ),
    );
    opts.appendChild(segmented('YOU BAT', [['R', 'Right'], ['L', 'Left']], this.prefs.bats, (v) => this.set({ bats: v })));
    opts.appendChild(segmented('YOU THROW', [['R', 'Right'], ['L', 'Left']], this.prefs.throws, (v) => this.set({ throws: v })));
    opts.appendChild(
      segmented('CPU HAND', [['R', 'Right'], ['L', 'Left'], ['S', 'Mix']], this.prefs.cpuHand, (v) => this.set({ cpuHand: v })),
    );

    this.el.querySelectorAll<HTMLButtonElement>('.mode-card').forEach((b) =>
      b.addEventListener('click', () => {
        const role = b.dataset.role as Role;
        onStart({
          role,
          difficulty: this.prefs.difficulty,
          userHand: role === 'batting' ? this.prefs.bats : this.prefs.throws,
          cpuHand: this.prefs.cpuHand,
        });
      }),
    );
  }

  private set(p: Partial<MenuPrefs>): void {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
  }

  show(): void {
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}

export class PauseMenu {
  private el: HTMLElement;

  constructor(parent: HTMLElement, handlers: { resume: () => void; restart: () => void; quit: () => void }) {
    this.el = document.createElement('div');
    this.el.className = 'overlay pause';
    this.el.innerHTML = `
      <div class="menu">
        <h1>PAUSED</h1>
        <button class="big" data-a="resume">Resume</button>
        <button class="big" data-a="restart">Restart session</button>
        <button class="big" data-a="quit">Quit to menu</button>
      </div>`;
    parent.appendChild(this.el);
    this.el.querySelector('[data-a=resume]')!.addEventListener('click', handlers.resume);
    this.el.querySelector('[data-a=restart]')!.addEventListener('click', handlers.restart);
    this.el.querySelector('[data-a=quit]')!.addEventListener('click', handlers.quit);
    this.hide();
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  show(): void {
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
