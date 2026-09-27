import type { Game, LogEntry, TeamBox } from '../sim/gameSim';
import { ordinal } from '../sim/gameSim';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function basesText(bases: ReadonlyArray<string | null>): string {
  const on = ['1st', '2nd', '3rd'].filter((_, i) => bases[i]);
  if (!on.length) return 'bases empty';
  if (on.length === 3) return 'bases loaded';
  return `runner${on.length > 1 ? 's' : ''} on ${on.join(' & ')}`;
}

export type MomentKind = 'bat' | 'pitch' | 'field';

const MOMENT_TITLE: Record<MomentKind, string> = {
  bat: "You're up",
  pitch: "You're on the mound",
  field: 'Ball hit your way!',
};

/** Recap between your moments, and the final box score. */
export class GameScreens {
  private el: HTMLElement;
  private onPlay: (() => void) | null = null;
  private keyHandler = (e: KeyboardEvent) => {
    if ((e.key === ' ' || e.key === 'Enter') && this.onPlay && this.el.style.display !== 'none') {
      e.preventDefault();
      this.onPlay();
    }
  };

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'overlay game-screen';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    window.addEventListener('keydown', this.keyHandler);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyHandler);
    this.el.remove();
  }

  hide(): void {
    this.el.style.display = 'none';
    this.onPlay = null;
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  private lineScore(g: Game): string {
    const n = Math.max(g.innings, g.lineScore.away.length, g.lineScore.home.length);
    const cols = Array.from({ length: n }, (_, i) => i + 1);
    const hits = (b: TeamBox) => Object.values(b.batting).reduce((a, l) => a + l.h, 0);
    const row = (side: 'away' | 'home') => {
      const t = g[side];
      const cells = cols
        .map((i) => {
          const v = g.lineScore[side][i - 1];
          return `<td>${v === undefined ? '' : Number.isNaN(v) ? 'x' : v}</td>`;
        })
        .join('');
      return `<tr class="${t.id === 'user' ? 'you' : ''}"><th>${esc(t.abbr)}</th>${cells}<td class="tot">${g.score[side]}</td><td class="tot">${hits(g.box[side])}</td></tr>`;
    };
    return `<div class="table-wrap"><table class="linescore">
      <thead><tr><th></th>${cols.map((c) => `<th>${c}</th>`).join('')}<th class="tot">R</th><th class="tot">H</th></tr></thead>
      <tbody>${row('away')}${row('home')}</tbody></table></div>`;
  }

  showRecap(g: Game, log: LogEntry[], kind: MomentKind, userLine: string, onPlay: () => void, onSim: () => void): void {
    const half = `${g.half === 'top' ? 'Top' : 'Bottom'} of the ${ordinal(g.inning)}`;
    const st = g.state.outs >= 3 ? { outs: 0, bases: [null, null, null] } : g.state;
    const situation = `${half} · ${st.outs} out${st.outs === 1 ? '' : 's'} · ${basesText(st.bases)}`;
    const matchup =
      kind === 'bat'
        ? `Facing ${esc(g.currentPitcher.name)} (${g.currentPitcher.throws}HP)`
        : kind === 'pitch'
          ? `${esc(g.batter.name)} due up`
          : `${esc(g.batter.name)} put it in play`;
    const lines = log.slice(-14);
    this.el.innerHTML = `
      <div class="menu recap">
        <div class="sub">${esc(situation)}</div>
        <h1>${MOMENT_TITLE[kind]}</h1>
        <p class="matchup-line">${matchup}${userLine ? ` · Today: <b>${esc(userLine)}</b>` : ''}</p>
        ${this.lineScore(g)}
        <div class="pbp">
          <h3>Since your last moment</h3>
          ${
            lines.length
              ? `<ol>${lines
                  .map((l) => `<li class="${l.runs ? 'scoring' : ''}"><span class="inn">${l.half === 'top' ? '▲' : '▼'}${l.inning}</span>${esc(l.text)}</li>`)
                  .join('')}</ol>`
              : '<p class="muted">Nothing yet. Play ball!</p>'
          }
        </div>
        <div class="actions">
          <button class="big primary" data-a="play">Play <kbd>Space</kbd></button>
          <button class="big" data-a="sim">Sim to end of game</button>
        </div>
      </div>`;
    this.el.style.display = '';
    this.onPlay = () => {
      this.hide();
      onPlay();
    };
    this.el.querySelector('[data-a=play]')!.addEventListener('click', () => this.onPlay?.());
    this.el.querySelector('[data-a=sim]')!.addEventListener('click', () => {
      this.hide();
      onSim();
    });
  }

  showBoxScore(g: Game, userId: string | null, onAgain: () => void, onMenu: () => void): void {
    const winner = g.score.home > g.score.away ? g.home : g.away;
    const youWon = winner.id === 'user';
    const battingTable = (side: 'away' | 'home') => {
      const b = g.box[side];
      const rows = b.order
        .map((id) => b.batting[id])
        .map(
          (l) =>
            `<tr class="${l.id === userId ? 'you' : ''}"><th>${esc(l.name)} <span class="pos">${l.pos}</span></th><td>${l.ab}</td><td>${l.r}</td><td>${l.h}</td><td>${l.rbi}</td><td>${l.bb}</td><td>${l.k}</td><td>${l.hr}</td></tr>`,
        )
        .join('');
      return `<div class="table-wrap"><table class="box"><caption>${esc(g[side].name)} batting</caption>
        <thead><tr><th></th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>HR</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    };
    const pitchingTable = (side: 'away' | 'home') => {
      const b = g.box[side];
      const rows = b.pitchersUsed
        .map((id) => b.pitching[id])
        .map(
          (l) =>
            `<tr class="${l.id === userId ? 'you' : ''}"><th>${esc(l.name)}</th><td>${Math.floor(l.outs / 3)}.${l.outs % 3}</td><td>${l.h}</td><td>${l.r}</td><td>${l.bb}</td><td>${l.k}</td><td>${l.pitches}</td></tr>`,
        )
        .join('');
      return `<div class="table-wrap"><table class="box"><caption>${esc(g[side].name)} pitching</caption>
        <thead><tr><th></th><th>IP</th><th>H</th><th>R</th><th>BB</th><th>K</th><th>P</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    };
    this.el.innerHTML = `
      <div class="menu boxscore">
        <div class="sub">FINAL${g.inning > g.innings ? ` · ${g.inning} INNINGS` : ''}</div>
        <h1>${youWon ? 'You win!' : `${esc(winner.name)} win`}</h1>
        ${this.lineScore(g)}
        <div class="box-grid">
          ${battingTable('away')}${battingTable('home')}
          ${pitchingTable('away')}${pitchingTable('home')}
        </div>
        <div class="actions">
          <button class="big primary" data-a="again">Play another game</button>
          <button class="big" data-a="menu">Main menu</button>
        </div>
      </div>`;
    this.el.style.display = '';
    this.onPlay = null;
    this.el.querySelector('[data-a=again]')!.addEventListener('click', () => {
      this.hide();
      onAgain();
    });
    this.el.querySelector('[data-a=menu]')!.addEventListener('click', () => {
      this.hide();
      onMenu();
    });
  }
}
