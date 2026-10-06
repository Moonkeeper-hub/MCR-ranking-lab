# v0.30.1 — Native TrueSkill

## Why

`ts-trueskill` 5.1.x pulls `mathjs`, and the affected `mathjs` range is reported by `npm audit` with high-severity advisories. The rating lab only needs one narrow TrueSkill use case, so v0.30.1 removes that dependency instead of accepting a vulnerable transitive package.

## Implementation

`src/engine/nativeTrueSkill.ts` contains a dependency-free Gaussian expectation-propagation factor graph for the exact use case of the lab:

- one tournament = one multiplayer free-for-all observation;
- one player per team;
- unique final places;
- no draws;
- configurable `beta`;
- input/output as `(mu, sigma)` pairs.

The graph consists of prior, likelihood, performance-difference and truncation factors. Adjacent finish-order constraints are iterated until convergence and then propagated back to the player skill variables. The surrounding `TrueSkillTournamentEngine` is unchanged conceptually: calendar `tau` decay and tournament-weight correction are still applied outside the pure TrueSkill tournament update.

## Dependency changes

Removed:

```text
ts-trueskill
mathjs (transitive)
```

No new runtime dependency was added.

After applying this patch over v0.30.0 run:

```powershell
npm.cmd install
npm.cmd audit
npm.cmd run build
```

`npm install` is required once so the existing lock file removes the old packages.

## Validation

The TypeScript project compiles with `tsc -b`. A canonical two-player smoke test with equal initial ratings (`mu=25`, `sigma=25/3`, `beta=25/6`) gives approximately:

```text
winner: mu 29.2052, sigma 7.1945
loser:  mu 20.7948, sigma 7.1945
```

which matches the standard no-draw TrueSkill update for this setup.
