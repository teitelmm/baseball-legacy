# Baseball Legacy

A 3D baseball career game for the browser (Three.js + TypeScript + Vite). You'll create a
player — an outfielder, pitcher, DH, or two-way player — and play a season as them.

## Roadmap

| Stage | What it adds | Status |
| --- | --- | --- |
| 1 | Core hitting & pitching: Batting Practice and Pitching Practice with count, outs and base runners | **Done** |
| 2 | Full games & fielding: AI fielders, throws, baserunning, outfield / DH / pitcher position play, 9-inning games | Planned |
| 3 | Home screen & player creation: position (LF/CF/RF/P/DH or two-way), bats/throws, appearance, archetypes | Planned |
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

## Controls (Stage 1)

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

**General**
- **Esc** — pause / quit to menu
- **`** (backtick) — debug & tuning panel (game speed, timing windows, PCI size, ratings, ball trail)
- **Space** or click — skip the replay after a pitch

## Code layout

```
src/core/     constants (field, physics, difficulty), types, seeded RNG, game clock, input, tuning
src/sim/      pure game logic, no rendering — pitch physics, pitch meter, swing/contact model,
              batted-ball flight, outcome odds, at-bat engine, CPU pitcher/batter AI
src/scene/    stadium, IK-driven primitive players + animations, ball, zone overlay, cameras
src/modes/    PracticeSession: the per-pitch state machine for both practice modes
src/ui/       HUD, menus, debug panel
src/audio/    synthesized sound effects
tests/        Vitest unit tests for src/sim
scripts/      Playwright smoke test
```

`src/sim` is deliberately independent of Three.js so later stages can simulate whole games
(e.g. the rest of the league in season mode) without rendering them.

World units are feet: home plate is at the origin, the pitcher is toward −z, and +x is the
first-base side.
