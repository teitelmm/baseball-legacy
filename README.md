# Baseball Legacy

A 3D baseball career game for the browser (Three.js + TypeScript + Vite). You'll create a
player — an outfielder, pitcher, DH, or two-way player — and play a season as them.

## Roadmap

| Stage | What it adds | Status |
| --- | --- | --- |
| 1 | Core hitting & pitching: Batting Practice and Pitching Practice with count, outs and base runners | **Done** |
| 2 | Full games & fielding: AI fielders, throws, baserunning, outfield / DH / pitcher position play, 3/6/9-inning games, box scores | **Done** |
| 3 | Home screen & player creation: position (LF/CF/RF/P/DH or two-way), bats/throws, appearance, archetypes | **Done** |
| 4 | Season mode: schedule, simulated league, standings, stats, progression, two-way rotation, save/load | Planned |

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # unit tests for the sim (pitch physics, meter, swing model, batted balls, at-bat engine, AI)
npm run typecheck  # tsc --noEmit
npm run build      # production build in dist/ (relative paths, can be hosted anywhere)
npm run smoke      # headless Playwright playtest of the built game (run `npm run build` first); screenshots in screenshots/
```

## Your player (Stage 3)

The game opens on the home screen. **Create your player** first:

- **Identity:** first and last name, and number (0–99). Your last name and number go on the back of your jersey.
- **Position:**
  - LF, CF, RF, DH or P.
  - **Two-way:** you pitch *and* play a hitting spot (LF, CF, RF or DH). Doing both costs 4 points on every rating.
- **Bats / Throws.**
- **Archetype:** sets your starting ratings.
  - Hitters: Contact Hitter, Power Slugger, Five-Tool, Speedster, Gap Hitter.
  - Pitchers: Flamethrower, Control Artist, Junkballer, Workhorse.
- **Bonus points:** 15 points to spend, up to +8 on any one rating.
- **Look:** skin tone, hair and hair color, facial hair, build, height (5'8"–6'6"), eye black, and bat and glove colors.

Up to three players are saved in your browser (**Change Player** on the home screen). Your player's name, ratings and look are used in practice and in games. A two-way player picks the day's role before each game:
- **Pitch + bat:** start on the mound and hit as the DH.
- **Play your position.**

## Playing a game (Stage 2)

Pick **Play Game** on the home screen and choose the difficulty, innings (3, 6 or 9) and whether your team is
home or away. It's "Road to the Show" style: you play your at-bats, the balls hit to your
area of the outfield, and every pitch while you're on the mound. Everything else is simulated, and a recap
with the line score and play-by-play appears before each of your moments. **Sim to end of game** (recap screen
or pause menu) finishes the game instantly. A box score appears at the end.

Fielders chase, catch and throw; runners run, take extra bases, tag up and get forced out. Pitchers tire
(watch the stamina bar) and the manager goes to the bullpen.

## Controls

**Hitting**
- **Mouse** — move the PCI (plate coverage indicator)
- **Left-click** — normal swing
- **Right-click** or **Shift+click** — power swing (smaller PCI and tighter timing, more exit velocity)
- Early swings pull the ball, late swings go the other way. The PCI above the ball tops it into
  the ground; below the ball lifts it.

**Pitching**
- **1–5** or click a button — choose a pitch
- **Mouse** — aim
- **Click** to start the meter, **click** to set power, **click** again on the yellow line for accuracy.
  The red zone at the top is max effort: a little more velocity, a lot less control.

**Fielding (outfield)**
- **W A S D** or **arrow keys** — run (relative to the camera); the yellow ring shows where the ball will land
- The catch is automatic when you get to the ball
- **1 / 2 / 3 / 4** — throw to first, second, third or home (the AI throws for you if you wait)

**General**
- **Esc** — pause / quit to menu
- **`** (backtick) — debug & tuning panel (game speed, timing windows, PCI size, ratings, ball trail)
- **Space** or click — skip the replay after a pitch

## Code layout

```
src/core/     constants (field, physics, difficulty), types, seeded RNG, game clock, input, tuning
src/sim/      pure game logic, no rendering — pitch physics, pitch meter, swing/contact model,
              batted-ball flight, play simulator (fielders, throws, runners), at-bat engine,
              full-game engine (box score, fatigue, bullpen), teams, CPU pitcher/batter AI
src/scene/    stadium, IK-driven primitive players + animations, ball, zone overlay, cameras
src/modes/    AtBatSession (live pitches), LivePlay (live ball in play), practice and game sessions
src/ui/       HUD, menus, debug panel
src/audio/    synthesized sound effects
tests/        Vitest unit tests for src/sim
scripts/      Playwright smoke test
```

`src/sim` is deliberately independent of Three.js so later stages can simulate whole games
(e.g. the rest of the league in season mode) without rendering them.

World units are feet: home plate is at the origin, the pitcher is toward −z, and +x is the
first-base side.
