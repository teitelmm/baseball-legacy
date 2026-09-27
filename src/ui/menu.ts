import type { DifficultyName } from '../core/constants';
import { DIFFICULTIES } from '../core/constants';
import type { Handedness } from '../core/types';
import type { Role } from '../modes/atBatSession';
import type { GameSetupOptions } from '../modes/gameSession';
import type { PracticeOptions } from '../modes/practiceHost';
import type { UserRole } from '../sim/team';

const STORAGE_KEY = 'baseball-legacy:practice-options';

interface MenuPrefs {
  difficulty: DifficultyName;
  bats: Handedness;
  throws: Handedness;
  cpuHand: Handedness | 'S';
  position: UserRole;
  innings: number;
  home: boolean;
}

function loadPrefs(): MenuPrefs {
  const defaults: MenuPrefs = { difficulty: 'pro', bats: 'R', throws: 'R', cpuHand: 'S', position: 'CF', innings: 3, home: true };
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

const POSITION_BLURB: Record<UserRole, string> = {
  LF: 'Hit, and cover left field. Balls hit your way are yours to run down.',
  CF: 'Hit, and patrol center, the most ground in the outfield.',
  RF: 'Hit, and cover right field. Strong arm needed for throws to third.',
  DH: 'Designated hitter: you only bat. Every at-bat counts.',
  P: 'Start on the mound and pitch every inning until the manager takes the ball.',
};

export interface MenuHandlers {
  practice: (opts: PracticeOptions) => void;
  game: (opts: GameSetupOptions) => void;
}

/** Main menu: play a game, or practice hitting and pitching. */
export class Menu {
  private el: HTMLElement;
  private prefs = loadPrefs();

  constructor(parent: HTMLElement, handlers: MenuHandlers) {
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    this.el.innerHTML = `
      <div class="menu">
        <h1>BASEBALL <span>LEGACY</span></h1>
        <div class="sub">STAGE 2 · FULL GAMES &amp; FIELDING</div>
        <div class="view-main">
          <div class="modes">
            <button class="mode-card feature" data-go="setup">
              <h2>Play a Game</h2>
              <p>Pick your position and play a game against a CPU team. You play your moments; the rest is simulated.</p>
            </button>
            <button class="mode-card" data-role="batting">
              <h2>Batting Practice</h2>
              <p>Step in against a CPU pitcher. Aim the PCI, time your swing, and drive the ball.</p>
            </button>
            <button class="mode-card" data-role="pitching">
              <h2>Pitching Practice</h2>
              <p>Take the mound against CPU hitters. Pick a pitch, hit your spot, and work the count.</p>
            </button>
          </div>
          <div class="options shared"></div>
          <div class="controls">
            <div>
              <h3>HITTING</h3>
              <ul>
                <li><kbd>Mouse</kbd> moves the PCI (contact cursor)</li>
                <li><kbd>Left-click</kbd> normal swing · <kbd>Right-click</kbd>/<kbd>Shift+click</kbd> power swing</li>
                <li>Early = pull · Late = opposite field</li>
                <li>PCI above the ball = grounder · below = fly ball</li>
              </ul>
            </div>
            <div>
              <h3>PITCHING</h3>
              <ul>
                <li><kbd>1–5</kbd> or click to choose a pitch · <kbd>Mouse</kbd> aims</li>
                <li><kbd>Click</kbd> start meter · <kbd>Click</kbd> set power</li>
                <li><kbd>Click</kbd> again on the yellow line for accuracy</li>
              </ul>
            </div>
            <div>
              <h3>FIELDING &amp; GENERAL</h3>
              <ul>
                <li><kbd>W A S D</kbd>/<kbd>Arrows</kbd> run · the catch is automatic</li>
                <li><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> throw to first, second, third, home</li>
                <li><kbd>Esc</kbd> pause · <kbd>\`</kbd> tuning panel · <kbd>Space</kbd> continue</li>
              </ul>
            </div>
          </div>
        </div>
        <div class="view-setup" style="display:none">
          <h2 class="setup-title">Game setup</h2>
          <div class="options game-opts"></div>
          <p class="pos-blurb"></p>
          <div class="actions">
            <button class="big primary" data-go="start">Play ball</button>
            <button class="big" data-go="back">Back</button>
          </div>
        </div>
      </div>`;
    parent.appendChild(this.el);

    const shared = this.el.querySelector('.shared')!;
    shared.appendChild(
      segmented(
        'DIFFICULTY',
        (Object.keys(DIFFICULTIES) as DifficultyName[]).map((d) => [d, DIFFICULTIES[d].label]),
        this.prefs.difficulty,
        (v) => this.set({ difficulty: v }),
        true,
      ),
    );
    shared.appendChild(segmented('YOU BAT', [['R', 'Right'], ['L', 'Left']], this.prefs.bats, (v) => this.set({ bats: v })));
    shared.appendChild(segmented('YOU THROW', [['R', 'Right'], ['L', 'Left']], this.prefs.throws, (v) => this.set({ throws: v })));
    shared.appendChild(
      segmented('CPU HAND (PRACTICE)', [['R', 'Right'], ['L', 'Left'], ['S', 'Mix']], this.prefs.cpuHand, (v) => this.set({ cpuHand: v })),
    );

    const blurb = this.el.querySelector<HTMLElement>('.pos-blurb')!;
    const game = this.el.querySelector('.game-opts')!;
    const positions: UserRole[] = ['LF', 'CF', 'RF', 'DH', 'P'];
    game.appendChild(
      segmented(
        'YOUR POSITION',
        positions.map((p) => [p, p]),
        this.prefs.position,
        (v) => {
          this.set({ position: v });
          blurb.textContent = POSITION_BLURB[v];
        },
        true,
      ),
    );
    game.appendChild(
      segmented(
        'INNINGS',
        [['3', '3'], ['6', '6'], ['9', '9']],
        String(this.prefs.innings) as '3' | '6' | '9',
        (v) => this.set({ innings: Number(v) }),
      ),
    );
    game.appendChild(segmented('YOUR TEAM', [['home', 'Home'], ['away', 'Away']], this.prefs.home ? 'home' : 'away', (v) => this.set({ home: v === 'home' })));
    blurb.textContent = POSITION_BLURB[this.prefs.position];

    const mainView = this.el.querySelector<HTMLElement>('.view-main')!;
    const setupView = this.el.querySelector<HTMLElement>('.view-setup')!;
    const show = (setup: boolean) => {
      mainView.style.display = setup ? 'none' : '';
      setupView.style.display = setup ? '' : 'none';
    };
    this.el.querySelector('[data-go=setup]')!.addEventListener('click', () => show(true));
    this.el.querySelector('[data-go=back]')!.addEventListener('click', () => show(false));
    this.el.querySelector('[data-go=start]')!.addEventListener('click', () => {
      show(false);
      handlers.game({
        role: this.prefs.position,
        bats: this.prefs.bats,
        throws: this.prefs.throws,
        difficulty: this.prefs.difficulty,
        innings: this.prefs.innings,
        home: this.prefs.home,
      });
    });

    this.el.querySelectorAll<HTMLButtonElement>('.mode-card[data-role]').forEach((b) =>
      b.addEventListener('click', () => {
        const role = b.dataset.role as Role;
        handlers.practice({
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

  private simBtn: HTMLElement;

  constructor(parent: HTMLElement, handlers: { resume: () => void; restart: () => void; quit: () => void; simToEnd: () => void }) {
    this.el = document.createElement('div');
    this.el.className = 'overlay pause';
    this.el.innerHTML = `
      <div class="menu">
        <h1>PAUSED</h1>
        <button class="big" data-a="resume">Resume</button>
        <button class="big" data-a="sim">Sim to end of game</button>
        <button class="big" data-a="restart">Restart</button>
        <button class="big" data-a="quit">Quit to menu</button>
      </div>`;
    parent.appendChild(this.el);
    this.el.querySelector('[data-a=resume]')!.addEventListener('click', handlers.resume);
    this.el.querySelector('[data-a=restart]')!.addEventListener('click', handlers.restart);
    this.el.querySelector('[data-a=quit]')!.addEventListener('click', handlers.quit);
    this.simBtn = this.el.querySelector<HTMLElement>('[data-a=sim]')!;
    this.simBtn.addEventListener('click', handlers.simToEnd);
    this.hide();
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  show(inGame = false): void {
    this.simBtn.style.display = inGame ? '' : 'none';
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
