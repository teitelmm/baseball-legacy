import { DIFFICULTIES, type DifficultyName } from '../core/constants';
import type { ProfileStore } from '../core/storage';
import type { GameSetupOptions } from '../modes/gameSession';
import type { Game } from '../sim/gameSim';
import {
  displayName,
  hittingSpot,
  isPitcher,
  isTwoWay,
  positionLabel,
  rating,
  RATING_LABEL,
  relevantKeys,
  upgrade,
  upgradeCost,
  type PlayerProfile,
} from '../sim/profile';
import {
  advanceDay,
  avg,
  buildMatchup,
  createSeason,
  daysUntilStart,
  gameRng,
  leaders,
  obp,
  playerName,
  ra9,
  recordGame,
  seriesWinner,
  simGame,
  simOthersToday,
  slg,
  standings,
  userGameToday,
  userRoleToday,
  userStillPlaying,
  type BatTotals,
  type PitchTotals,
  type Season,
  type SeasonGame,
  type SeasonLength,
} from '../sim/season';
import { esc, h, segmented } from './home';

export interface SeasonHubHandlers {
  /** Start a season game (the hub is hidden while it's played). */
  play: (opts: GameSetupOptions) => void;
  /** A season game ended: stop it and come back to the hub. */
  leaveGame: () => void;
  home: () => void;
  /** Your player changed (skill points earned or spent). */
  profileChanged: (p: PlayerProfile) => void;
}

type Tab = 'standings' | 'you' | 'leaders' | 'playoffs' | 'upgrade';

const TABS: Array<[Tab, string]> = [
  ['standings', 'Standings'],
  ['you', 'Your stats'],
  ['upgrade', 'Upgrades'],
  ['leaders', 'Leaders'],
  ['playoffs', 'Playoffs'],
];

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

function avg3(v: number): string {
  return v >= 1 ? v.toFixed(3) : v.toFixed(3).slice(1);
}

function ip(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

/** The season hub: setup, standings, your stats, upgrades, leaders, playoffs. */
export class SeasonHub {
  private el: HTMLElement;
  private slot = 0;
  private profile: PlayerProfile | null = null;
  private season: Season | null = null;
  private tab: Tab = 'standings';
  private banner: string | null = null;
  private busy: string | null = null;
  private setup: { length: SeasonLength; innings: 3 | 6 | 9; difficulty: DifficultyName } = { length: 20, innings: 9, difficulty: 'pro' };
  private note = '';

  constructor(
    parent: HTMLElement,
    private readonly store: ProfileStore,
    private readonly handlers: SeasonHubHandlers,
  ) {
    this.el = h('div', { class: 'overlay season' });
    parent.appendChild(this.el);
    this.hide();
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  /** Open the hub for a player (loads their season, or shows the new-season setup). */
  open(slot: number, profile: PlayerProfile, difficulty: DifficultyName): void {
    this.slot = slot;
    this.profile = profile;
    this.setup.difficulty = difficulty;
    this.banner = null;
    this.note = '';
    let s = this.store.loadSeason(slot);
    if (s && (s.profileId !== profile.id || (s.roleKey && s.roleKey !== positionLabel(profile)))) {
      this.note = 'Your position changed since your last season began, so that season was closed. Start a new one.';
      this.store.removeSeason(slot);
      s = null;
    }
    this.season = s;
    this.show();
  }

  show(): void {
    this.el.style.display = '';
    this.render();
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  /** For tests. */
  get state(): Season | null {
    return this.season;
  }

  // -------------------------------------------------------------------------
  // Flow

  private save(): void {
    if (this.season) this.store.saveSeason(this.slot, this.season);
  }

  private addPoints(points: number): void {
    if (!points || !this.profile) return;
    this.setProfile({ ...this.profile, skillPoints: (this.profile.skillPoints ?? 0) + points });
  }

  private setProfile(p: PlayerProfile): void {
    this.profile = p;
    this.store.save(this.slot, p);
    this.handlers.profileChanged(p);
  }

  private start(): void {
    this.season = createSeason(this.profile!, { ...this.setup, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0 });
    this.tab = 'standings';
    this.banner = `Welcome to the ${this.season.teams[this.season.userTeamId].name}! ${this.setup.length} games, top four make the playoffs.`;
    this.save();
    this.render();
  }

  private gameLabel(s: Season, sg: SeasonGame): string {
    if (sg.series === undefined) return `Day ${sg.day + 1} of ${s.regularDays}`;
    const se = s.series[sg.series];
    return `${se.round === 'final' ? 'Championship' : 'Semifinal'} · Game ${se.winsA + se.winsB + 1}`;
  }

  private playToday(): void {
    const s = this.season!;
    const p = this.profile!;
    simOthersToday(s, p);
    const sg = userGameToday(s);
    const role = userRoleToday(s, p);
    if (!sg || role === 'rest') return;
    this.save();
    const { home, away } = buildMatchup(s, sg, p);
    this.hide();
    this.handlers.play({
      profile: p,
      today: role,
      difficulty: s.opts.difficulty,
      innings: s.opts.innings,
      home: sg.home === s.userTeamId,
      season: {
        home,
        away,
        rng: gameRng(s, sg),
        label: this.gameLabel(s, sg),
        onFinal: (g, fieldingOuts) => this.finishGame(sg, g, fieldingOuts),
      },
    });
  }

  private finishGame(sg: SeasonGame, g: Game, fieldingOuts: number): void {
    const s = this.season!;
    if (!sg.result) {
      const pts = recordGame(s, sg, g, { fieldingOuts });
      this.addPoints(pts);
      const last = s.log[s.log.length - 1];
      this.banner = `${last.score} ${last.home ? 'vs' : '@'} ${last.opp} · ${last.line} · +${pts} skill point${pts === 1 ? '' : 's'}`;
      advanceDay(s);
      this.save();
    }
    this.tab = s.phase === 'done' ? this.tab : 'you';
    this.handlers.leaveGame();
  }

  /** Simulate one day, your game included. Returns your points. */
  private simDay(): number {
    const s = this.season!;
    const p = this.profile!;
    simOthersToday(s, p);
    const sg = userGameToday(s);
    let pts = 0;
    if (sg) pts = recordGame(s, sg, simGame(s, sg, p), { simmed: true });
    advanceDay(s);
    return pts;
  }

  /** Simulate days (a frame between each so the page stays responsive) until `done` says stop. */
  private async simUntil(done: (s: Season) => boolean, what: string): Promise<void> {
    const s = this.season!;
    let days = 0;
    let pts = 0;
    const startLog = s.log.length;
    const startDay = s.day;
    while (s.phase !== 'done' && days < 400) {
      this.busy = `${what}… ${s.phase === 'regular' ? `day ${s.day + 1} of ${s.regularDays}` : 'playoffs'}`;
      this.render();
      await nextFrame();
      pts += this.simDay();
      days++;
      if (done(s)) break;
    }
    this.busy = null;
    this.addPoints(pts);
    const mine = s.log.slice(startLog);
    const w = mine.filter((l) => l.won).length;
    const played = s.day - startDay;
    this.banner =
      mine.length === 1
        ? `${mine[0].score} ${mine[0].home ? 'vs' : '@'} ${mine[0].opp} · ${mine[0].line} · +${pts} skill point${pts === 1 ? '' : 's'} (simmed)`
        : `Simmed ${played} day${played === 1 ? '' : 's'}${mine.length ? ` · went ${w}-${mine.length - w}` : ''} · +${pts} skill point${pts === 1 ? '' : 's'}`;
    this.save();
    this.render();
  }

  // -------------------------------------------------------------------------
  // Rendering

  private render(): void {
    this.el.innerHTML = '';
    const panel = h('div', { class: 'season-panel' });
    this.el.appendChild(panel);
    const s = this.season;
    if (!s) this.renderSetup(panel);
    else if (s.phase === 'done') this.renderDone(panel, s);
    else this.renderHub(panel, s);
  }

  private renderSetup(panel: HTMLElement): void {
    const p = this.profile!;
    panel.appendChild(h('div', { class: 'sub' }, 'NEW SEASON'));
    panel.appendChild(h('h1', {}, `${esc(displayName(p))} <span>· ${positionLabel(p)}</span>`));
    if (this.note) panel.appendChild(h('p', { class: 'lead warn' }, esc(this.note)));
    panel.appendChild(
      h(
        'p',
        { class: 'lead' },
        'An eight-team league. Play your moments in every game (pitchers take the ball every fifth day), earn skill points, and chase a title: the top four make the playoffs, with best-of-5 semifinals and a best-of-7 final.',
      ),
    );
    const opts = h('div', { class: 'options' });
    opts.appendChild(
      segmented('season-length', 'SEASON LENGTH', [['20', '20 games'], ['40', '40 games'], ['81', '81 games']], String(this.setup.length) as '20' | '40' | '81', (v) => {
        this.setup.length = Number(v) as SeasonLength;
      }, true),
    );
    opts.appendChild(
      segmented('season-innings', 'INNINGS PER GAME', [['3', '3'], ['6', '6'], ['9', '9']], String(this.setup.innings) as '3' | '6' | '9', (v) => {
        this.setup.innings = Number(v) as 3 | 6 | 9;
      }),
    );
    opts.appendChild(
      segmented(
        'season-difficulty',
        'DIFFICULTY',
        (Object.keys(DIFFICULTIES) as DifficultyName[]).map((d) => [d, DIFFICULTIES[d].label]),
        this.setup.difficulty,
        (v) => (this.setup.difficulty = v),
        true,
      ),
    );
    panel.appendChild(opts);
    const actions = h('div', { class: 'actions' });
    const start = h('button', { class: 'big primary', type: 'button', 'data-a': 'season-start' }, 'Start season');
    start.addEventListener('click', () => this.start());
    const back = h('button', { class: 'big', type: 'button', 'data-a': 'season-home' }, 'Back');
    back.addEventListener('click', () => this.handlers.home());
    actions.append(start, back);
    panel.appendChild(actions);
  }

  private header(panel: HTMLElement, s: Season): void {
    const rows = standings(s);
    const me = rows.find((r) => r.id === s.userTeamId)!;
    const place = rows.indexOf(me);
    const phase =
      s.phase === 'regular'
        ? `Day ${Math.min(s.day + 1, s.regularDays)} of ${s.regularDays}`
        : s.phase === 'playoffs'
          ? s.series.some((x) => x.round === 'final')
            ? 'Championship Series'
            : 'Semifinals'
          : 'Season over';
    const head = h('div', { class: 'season-head' });
    head.innerHTML = `
      <div>
        <div class="sub">${esc(s.teams[s.userTeamId].name.toUpperCase())} · ${esc(phase.toUpperCase())}</div>
        <h1>${me.w}-${me.l} <span>${me.w + me.l ? `${ORDINAL[place]} place` : 'Opening Day'}</span></h1>
      </div>
      <div class="sp-chip" title="Skill points to spend on upgrades"><b>${this.profile!.skillPoints ?? 0}</b><span>skill points</span></div>`;
    panel.appendChild(head);
  }

  private renderHub(panel: HTMLElement, s: Season): void {
    this.header(panel, s);
    if (this.banner) panel.appendChild(h('div', { class: 'season-banner', role: 'status' }, esc(this.banner)));
    panel.appendChild(this.nextCard(s));
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const [t, label] of TABS) {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(t === this.tab), 'data-tab': t }, label);
      if (t === this.tab) b.classList.add('sel');
      b.addEventListener('click', () => {
        this.tab = t;
        this.render();
      });
      tabs.appendChild(b);
    }
    panel.appendChild(tabs);
    const body = h('div', { class: 'tab-body game-screen' });
    panel.appendChild(body);
    switch (this.tab) {
      case 'standings':
        this.renderStandings(body, s);
        break;
      case 'you':
        this.renderYou(body, s);
        break;
      case 'upgrade':
        this.renderUpgrades(body);
        break;
      case 'leaders':
        this.renderLeaders(body, s);
        break;
      case 'playoffs':
        this.renderPlayoffs(body, s);
        break;
    }
  }

  private nextCard(s: Season): HTMLElement {
    const p = this.profile!;
    const card = h('div', { class: 'next-card' });
    const sg = userGameToday(s);
    const role = userRoleToday(s, p);
    const recs = new Map(standings(s).map((r) => [r.id, `${r.w}-${r.l}`]));
    let title: string;
    let detail: string;
    if (sg) {
      const home = sg.home === s.userTeamId;
      const opp = s.teams[home ? sg.away : sg.home];
      title = `${this.gameLabel(s, sg)}: ${home ? 'vs' : '@'} ${esc(opp.name)} <span class="muted">(${recs.get(opp.id)})</span>`;
      if (sg.series !== undefined) {
        const se = s.series[sg.series];
        const mine = se.a === s.userTeamId ? se.winsA : se.winsB;
        const theirs = se.a === s.userTeamId ? se.winsB : se.winsA;
        title += ` <span class="muted">· series ${mine}-${theirs}</span>`;
      }
      if (role === 'pitch') detail = isTwoWay(p) ? 'You start on the mound and bat as the DH.' : 'You start on the mound today.';
      else if (role === 'field') {
        const order = s.teams[s.userTeamId].lineup.indexOf(s.userId);
        detail = `You bat ${ORDINAL[Math.max(0, order)]} and play ${hittingSpot(p) === 'DH' ? 'DH' : hittingSpot(p)}.`;
      } else {
        const n = daysUntilStart(s);
        detail = `Day off. ${n === null ? '' : `Your next start is in ${n} day${n === 1 ? '' : 's'}.`}`;
      }
    } else if (!userStillPlaying(s)) {
      title = 'Your season is over';
      const live = s.series.filter((x) => !seriesWinner(x));
      detail = live.length ? live.map((x) => `${esc(s.teams[x.a].abbr)} vs ${esc(s.teams[x.b].abbr)} (${x.winsA}-${x.winsB})`).join(' · ') : 'Waiting on the other series.';
    } else {
      title = 'No game today';
      detail = 'Waiting on the other series.';
    }
    card.innerHTML = `<div class="nc-title">${title}</div><div class="nc-detail">${detail}</div>`;
    const actions = h('div', { class: 'actions' });
    const btn = (label: string, a: string, fn: () => void, primary = false) => {
      const b = h('button', { class: `big${primary ? ' primary' : ''}`, type: 'button', 'data-a': a }, label);
      if (this.busy) b.setAttribute('disabled', '');
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };
    if (sg && role !== 'rest') {
      btn('Play game', 'season-play', () => this.playToday(), true);
      btn('Sim game', 'season-sim-game', () => void this.simUntil(() => true, 'Simulating'));
    } else {
      btn('Sim day', 'season-sim-day', () => void this.simUntil(() => true, 'Simulating'), true);
      if (sg && isPitcher(p) && userStillPlaying(s))
        btn('Sim to next start', 'season-sim-start', () => void this.simUntil((x) => userRoleToday(x, p) !== 'rest' || !userStillPlaying(x), 'Simulating'));
    }
    if (s.phase === 'regular') btn('Sim to playoffs', 'season-sim-reg', () => void this.simUntil((x) => x.phase !== 'regular', 'Simulating'));
    else btn('Sim rest of playoffs', 'season-sim-all', () => void this.simUntil(() => false, 'Simulating'));
    btn('Home', 'season-home', () => this.handlers.home());
    card.appendChild(actions);
    if (this.busy) card.appendChild(h('div', { class: 'busy', role: 'status' }, esc(this.busy)));
    return card;
  }

  private renderStandings(body: HTMLElement, s: Season): void {
    const rows = standings(s);
    const html = rows
      .map(
        (r, i) =>
          `<tr class="${r.id === s.userTeamId ? 'you' : ''}${i === 3 ? ' cut' : ''}"><td>${i + 1}</td><th>${esc(r.name)}</th><td>${r.w}</td><td>${r.l}</td><td>${avg3(r.pct)}</td><td>${r.gb ? r.gb.toFixed(1) : '—'}</td><td>${r.rs}</td><td>${r.ra}</td><td>${r.streak}</td></tr>`,
      )
      .join('');
    body.innerHTML = `<div class="table-wrap"><table class="standings">
      <thead><tr><th></th><th>TEAM</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>RS</th><th>RA</th><th>STRK</th></tr></thead>
      <tbody>${html}</tbody></table></div>
      <p class="muted small">Top four make the playoffs.</p>`;
  }

  private batTable(label: string, b: BatTotals | undefined): string {
    if (!b) return '';
    return `<table class="statline"><caption>${label}</caption>
      <thead><tr><th>G</th><th>AB</th><th>R</th><th>H</th><th>2B</th><th>3B</th><th>HR</th><th>RBI</th><th>BB</th><th>K</th><th>AVG</th><th>OBP</th><th>SLG</th></tr></thead>
      <tbody><tr><td>${b.g}</td><td>${b.ab}</td><td>${b.r}</td><td>${b.h}</td><td>${b.doubles}</td><td>${b.triples}</td><td>${b.hr}</td><td>${b.rbi}</td><td>${b.bb}</td><td>${b.k}</td><td>${avg3(avg(b))}</td><td>${avg3(obp(b))}</td><td>${avg3(slg(b))}</td></tr></tbody></table>`;
  }

  private pitchTable(label: string, p: PitchTotals | undefined): string {
    if (!p) return '';
    return `<table class="statline"><caption>${label}</caption>
      <thead><tr><th>G</th><th>GS</th><th>IP</th><th>H</th><th>R</th><th>BB</th><th>K</th><th>HR</th><th>RA9</th></tr></thead>
      <tbody><tr><td>${p.g}</td><td>${p.gs}</td><td>${ip(p.outs)}</td><td>${p.h}</td><td>${p.r}</td><td>${p.bb}</td><td>${p.k}</td><td>${p.hr}</td><td>${ra9(p).toFixed(2)}</td></tr></tbody></table>`;
  }

  private renderYou(body: HTMLElement, s: Season): void {
    const id = s.userId;
    const parts = [
      this.batTable('BATTING', s.stats.bat[id]),
      this.pitchTable('PITCHING', s.stats.pitch[id]),
      this.batTable('POSTSEASON BATTING', s.postStats.bat[id]),
      this.pitchTable('POSTSEASON PITCHING', s.postStats.pitch[id]),
    ].filter(Boolean);
    const log = s.log
      .slice(-25)
      .reverse()
      .map(
        (l) =>
          `<tr><td>${l.playoff ? 'PO' : l.day + 1}</td><td>${l.home ? 'vs' : '@'} ${esc(l.opp)}</td><td class="${l.won ? 'w' : 'l'}">${esc(l.score)}</td><th>${esc(l.line)}${l.simmed ? ' <span class="muted">(sim)</span>' : ''}</th><td>+${l.points}</td></tr>`,
      )
      .join('');
    body.innerHTML = `
      ${parts.length ? `<div class="table-wrap">${parts.join('')}</div>` : '<p class="muted">No stats yet — play your first game.</p>'}
      ${log ? `<div class="table-wrap"><table class="gamelog"><caption>GAME LOG</caption><thead><tr><th>DAY</th><th>OPP</th><th>RESULT</th><th>YOU</th><th>PTS</th></tr></thead><tbody>${log}</tbody></table></div>` : ''}`;
  }

  private renderUpgrades(body: HTMLElement): void {
    const p = this.profile!;
    const pts = p.skillPoints ?? 0;
    body.innerHTML = `<p class="muted">Earn skill points in every game you play (simulated games earn half). Spend them here — higher ratings cost more.</p>`;
    const list = h('div', { class: 'upgrades' });
    for (const k of relevantKeys(p)) {
      const v = rating(p, k);
      const cost = upgradeCost(v);
      const earned = p.progress?.[k] ?? 0;
      const row = h('div', { class: 'up-row' });
      row.innerHTML = `<span class="up-name">${RATING_LABEL[k]}</span><i class="bar"><i style="width:${v}%"></i></i><b>${v}</b><span class="muted up-earned">${earned ? `+${earned}` : ''}</span>`;
      const b = h('button', { type: 'button', 'data-up': k, 'aria-label': `Raise ${RATING_LABEL[k]} for ${cost} points` }, `+1 · ${cost} pts`);
      if (pts < cost || v >= 99 || this.busy) b.setAttribute('disabled', '');
      b.addEventListener('click', () => {
        const next = upgrade(this.profile!, k);
        if (!next) return;
        this.setProfile(next);
        this.banner = `${RATING_LABEL[k]} is now ${rating(next, k)}.`;
        this.render();
      });
      row.appendChild(b);
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  private renderLeaders(body: HTMLElement, s: Season): void {
    const L = leaders(s, 5);
    const block = (title: string, rows: typeof L.avg) =>
      `<table class="leaders"><caption>${title}</caption><tbody>${
        rows.length
          ? rows.map((r) => `<tr class="${r.id === s.userId ? 'you' : ''}"><th>${esc(r.name)} <span class="muted">${esc(r.team)}</span></th><td>${r.text}</td></tr>`).join('')
          : '<tr><td class="muted">Not enough games yet</td></tr>'
      }</tbody></table>`;
    body.innerHTML = `<div class="leader-grid">
      ${block('BATTING AVG', L.avg)}${block('HOME RUNS', L.hr)}${block('RBI', L.rbi)}${block('STRIKEOUTS', L.k)}${block('RUNS ALLOWED / 9', L.ra9)}
    </div>`;
  }

  private renderPlayoffs(body: HTMLElement, s: Season): void {
    if (!s.series.length) {
      const seeds = standings(s).slice(0, 4);
      body.innerHTML = `<p class="muted">If the season ended today:</p>
        <div class="bracket">
          ${this.seriesBox(s, seeds[0].id, seeds[3].id, 'Semifinal · best of 5', null)}
          ${this.seriesBox(s, seeds[1].id, seeds[2].id, 'Semifinal · best of 5', null)}
        </div>`;
      return;
    }
    body.innerHTML = `<div class="bracket">${s.series
      .map((se) => this.seriesBox(s, se.a, se.b, `${se.round === 'final' ? 'Championship' : 'Semifinal'} · best of ${se.bestOf}`, [se.winsA, se.winsB], seriesWinner(se)))
      .join('')}</div>`;
  }

  private seriesBox(s: Season, a: string, b: string, label: string, wins: [number, number] | null, winner: string | null = null): string {
    const row = (id: string, w: number | null) =>
      `<div class="br-team${id === s.userTeamId ? ' you' : ''}${winner === id ? ' won' : winner ? ' out' : ''}"><span>${esc(s.teams[id].name)}</span><b>${w ?? ''}</b></div>`;
    return `<div class="series"><div class="br-label">${label}</div>${row(a, wins?.[0] ?? null)}${row(b, wins?.[1] ?? null)}</div>`;
  }

  private renderDone(panel: HTMLElement, s: Season): void {
    const champ = s.champion ? s.teams[s.champion] : null;
    const won = s.champion === s.userTeamId;
    panel.appendChild(h('div', { class: 'sub' }, 'SEASON OVER'));
    panel.appendChild(h('h1', { class: won ? 'champ' : '' }, won ? 'CHAMPIONS!' : `${esc(champ?.name ?? '')} <span>win it all</span>`));
    if (this.banner) panel.appendChild(h('div', { class: 'season-banner', role: 'status' }, esc(this.banner)));
    const award = (id: string | null) => {
      if (!id) return '—';
      const n = playerName(s, id);
      return `<span class="${id === s.userId ? 'you' : ''}">${esc(n.name)} <span class="muted">${esc(n.team)}</span></span>`;
    };
    const card = h('div', { class: 'next-card' });
    const me = standings(s).find((r) => r.id === s.userTeamId)!;
    const mine = s.series.filter((x) => x.a === s.userTeamId || x.b === s.userTeamId);
    const finish = won
      ? 'Champions'
      : mine.some((x) => x.round === 'final')
        ? 'Lost the Championship'
        : mine.length
          ? 'Lost in the Semifinals'
          : 'Missed the playoffs';
    card.innerHTML = `
      <div class="awards">
        <div><span class="muted">MVP</span>${award(s.awards?.mvp ?? null)}</div>
        <div><span class="muted">BEST PITCHER</span>${award(s.awards?.cy ?? null)}</div>
        <div><span class="muted">YOUR TEAM</span>${me.w}-${me.l} · ${finish}</div>
      </div>`;
    panel.appendChild(card);
    const body = h('div', { class: 'tab-body game-screen' });
    panel.appendChild(body);
    this.renderYou(body, s);
    const bracket = h('div', { class: 'tab-body game-screen' });
    this.renderPlayoffs(bracket, s);
    panel.appendChild(bracket);
    const actions = h('div', { class: 'actions' });
    const again = h('button', { class: 'big primary', type: 'button', 'data-a': 'season-new' }, 'New season');
    again.addEventListener('click', () => {
      this.store.removeSeason(this.slot);
      this.season = null;
      this.banner = null;
      this.note = '';
      this.render();
    });
    const home = h('button', { class: 'big', type: 'button', 'data-a': 'season-home' }, 'Home');
    home.addEventListener('click', () => this.handlers.home());
    actions.append(again, home);
    panel.appendChild(actions);
  }
}
