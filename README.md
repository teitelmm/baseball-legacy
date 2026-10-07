# Baseball Legacy

A 3D baseball career game for the browser (Three.js + TypeScript + Vite). You'll create a
player — an outfielder, pitcher, DH, or two-way player — and play a season as them.

## Roadmap

| Stage | What it adds | Status |
| --- | --- | --- |
| 1 | Core hitting & pitching: Batting Practice and Pitching Practice with count, outs and base runners | **Done** |
| 2 | Full games & fielding: AI fielders, throws, baserunning, outfield / DH / pitcher position play, 3/6/9-inning games, box scores | **Done** |
| 3 | Home screen & player creation: position (LF/CF/RF/P/DH or two-way), bats/throws, appearance, archetypes | **Done** |
| 4 | Season mode: 8-team league, schedule, simulated games, standings, stats, leaders, skill-point progression, two-way rotation, playoffs, save/load | **Done** |

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
npm run smoke:season  # just the season playtest (create a player, play/sim games, upgrade, sim to a champion)
```

## Season (Stage 4)

Pick **Start Season** on the home screen and choose:
- **Length:** 20, 40 or 81 games.
- **Innings per game:** 3, 6 or 9.
- **Difficulty.**

Your player joins the Legacy City Legends in an eight-team league. Every team plays every day.

**Game days:**
- **Hitters** play every game.
- **Pitchers** start every fifth day, as part of a five-man rotation.
- **Two-way players** pitch (and DH) on their start days, and play their hitting spot on the other days.

On days you don't play, **Sim day** or **Sim to next start**. Games you play live work like an exhibition game. Leaving a season game from the pause menu sims the rest of it, and the result still counts.

**Skill points:** you earn them for what you do: hits, extra bases, RBI, walks, outs and strikeouts on the mound, quality starts, outs you make in the field, and wins. Games you sim earn half. Spend them on the **Upgrades** tab; higher ratings cost more (3/4/6/8 points per +1). Upgrades carry over to your next season. Upgrades are also on the home screen (**Upgrades · N pts**), and exhibition games with your player earn half the season rate; the final box score shows what you earned.

**The hub:**
- **Standings:** the dashed line is the playoff cut.
- **Your stats:** season and postseason lines, plus a game log.
- **Leaders:** AVG, HR, RBI, K, RA/9.
- **Playoffs:** the bracket.

**Playoffs:** the top four teams make it.
- **Semifinals:** 1 vs 4 and 2 vs 3, best of 5 (2-2-1).
- **Final:** best of 7 (2-3-2).

When the season ends, MVP and Best Pitcher awards are handed out.

Each save slot keeps its own season in your browser. **Continue Season** picks up where you left off.

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

Players are built from shaped parts rather than blocks: a cranium and jaw with eyes, lids, brows, a nose and lips; a muscled torso and limbs; hands with fingers and a fielder's glove with finger stalls and webbing. Uniforms are cloth with a visible weave, a button placket with piping, a collar, a belt with a buckle, and team pinstripes and cap logos where the team wears them.

Up to three players are saved in your browser (**Change Player** on the home screen). Your player's name, ratings and look are used in practice and in games. A two-way player picks the day's role before each game:
- **Pitch + bat:** start on the mound and hit as the DH.
- **Play your position.**

## Playing a game (Stage 2)

Pick **Exhibition Game** on the home screen and choose the difficulty, innings (3, 6 or 9) and whether your team is
home or away. It's "Road to the Show" style: you play your at-bats, the balls hit to your
area of the outfield, and every pitch while you're on the mound. Everything else is simulated, and a recap
with the line score and play-by-play appears before each of your moments. **Sim to end of game** (recap screen
or pause menu) finishes the game instantly. A box score appears at the end.

Fielders chase, catch and throw; runners run, take extra bases, tag up and get forced out. Pitchers tire
(watch the stamina bar) and the manager goes to the bullpen.

Fielding is realistic rather than automatic:
- **Movement:** fielders take a moment to read the ball, then accelerate up to a sprint. Outfielders are a
  step slower going back on a ball over their heads.
- **Catching:** it isn't guaranteed. Balls at the edge of a fielder's reach, running catches and hard-hit
  grounders and liners are harder. Misses either get past the fielder or get bobbled and picked up late.
- **Diving:** fielders lay out for balls just out of reach, and sometimes come up with them.
- **Throwing:** long throws and weaker arms go wide more often, pulling the receiver off the bag.
- **What you see:** fielders crouch into a ready stance as the pitch is delivered, reach the glove to where
  the ball actually is, and crow-hop and throw toward the base.

## Controls

**Hitting**
- **Mouse** — move the PCI (plate coverage indicator)
- **Left-click** — normal swing. Click just as the ball reaches the plate; that's perfect timing.
  (Rookie's shrinking ring closes at exactly that moment.)
- **Right-click** or **Shift+click** — power swing (smaller PCI and tighter timing, more exit velocity)
- Early swings pull the ball, late swings go the other way. The PCI above the ball tops it into
  the ground; below the ball lifts it.
- **Reading the pitch:**
  - The batting camera sits behind the plate, level with the middle of the strike zone, so a pitch's
    height on screen matches its height in the zone.
  - A comet tail follows each pitch along its real path, colored by pitch type (four-seam red, sinker
    orange, slider yellow, curveball blue, changeup green).
  - The **ball tracker** dot on the strike zone shows the ball's current height and side as it comes in,
    so you can line the PCI up with it.
  - How much of this you get depends on difficulty: the tracker is full on Rookie, a bit fainter on Pro,
    faint on All-Star and off on Legend, and the tail gets shorter on the harder levels.
  - Rookie also marks where the pitch will cross.
  - Earlier pitches' markers fade while the ball is in the air so they aren't mistaken for it.

**Pitching**
- **1–5** or click a button — choose a pitch
- **Mouse** — aim
- **Click** to start the meter, **click** to set power, **click** again on the yellow line for accuracy.
  The red zone at the top is max effort: a little more velocity, a lot less control.

**After you hit it**, the camera stays down at field level beside home plate for about three seconds,
following the ball off the bat, then rises to the wide view for the rest of the play.

**Fielding (outfield)**
- **W A S D** or **arrow keys** — run (relative to the camera); the yellow ring shows where the ball will land
- The catch is automatic when you get to the ball
- **1 / 2 / 3 / 4** — throw to first, second, third or home (the AI throws for you if you wait)

**General**
- **Esc** — pause / quit to menu
- **`** (backtick) — debug & tuning panel (game speed, timing windows, PCI size, ratings, ball trail, pitch tail, ball tracker)
- **Space** or click — skip the replay after a pitch

## Code layout

```
src/core/     constants (field, physics, difficulty), types, seeded RNG, game clock, input, tuning
src/sim/      pure game logic, no rendering — pitch physics, pitch meter, swing/contact model,
              batted-ball flight, play simulator (fielders, throws, runners), at-bat engine,
              full-game engine (box score, fatigue, bullpen), teams, CPU pitcher/batter AI,
              player profiles, season (schedule, stats, standings, playoffs)
src/scene/    stadium, IK-driven primitive players + animations, ball, zone overlay, cameras
src/modes/    AtBatSession (live pitches), LivePlay (live ball in play), practice and game sessions
src/ui/       HUD, home screen and creator, season hub, menus, debug panel
src/audio/    synthesized sound effects
tests/        Vitest unit tests for src/sim
scripts/      Playwright smoke tests
```

`src/sim` is deliberately independent of Three.js so later stages can simulate whole games
(e.g. the rest of the league in season mode) without rendering them.

World units are feet: home plate is at the origin, the pitcher is toward −z, and +x is the
first-base side.
