const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

// Load the browser's actual TypeScript engine in Node without another runtime
// dependency or generated files in the repository. npm run build type-checks it.
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(result.outputText, filename);
};

const { Mcr2026Engine, defaultDescribedMcrConfig, defaultMcr2026Config } = require('../src/engine/legacy.ts');
const { EvolutionEngine } = require('../src/engine/evolution.ts');
const { simulateMcr2026History } = require('../src/engine/simulation.ts');
const { playersFromCsv } = require('../src/data/csv.ts');
const { renderMcr2026Math } = require('../src/ui/formulas.ts');

const config = defaultDescribedMcrConfig();
const eventDate = new Date('2026-02-01T00:00:00Z');
const engine = (overrides = {}, tables = {}) => new Mcr2026Engine({ ...config, ...overrides }, tables);
const state = (eu, marks = 0, date = '2026-01-01', expiryPeriodsApplied = 0) => ({
  eu, marks, danDate: date ? new Date(`${date}T00:00:00Z`) : null, expiryPeriodsApplied,
});
function fixture(eu = 2000, sessions = 24, date = '2026-02-01') {
  const players = Array.from({ length: 12 }, (_, i) => ({
    player_id: String(i + 1), player_name: `Player ${i + 1}`,
    initial_eu: eu, initial_marks: 0, initial_dan_date: '2026-01-01',
    include_in_rating: true,
  }));
  const results = players.map((p, i) => ({
    tournament_id: 't1', tournament_name: 'Tournament 1', tournament_date: date,
    tournament_order: 0, player_id: p.player_id, place: i + 1,
    participants: 12, sessions, is_status_tournament: false, is_substitute: false,
  }));
  return { players, results };
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); }

test('all known players contribute provisional EU; final evolution starts at EU0', () => {
  const { players, results } = fixture();
  const actual = engine().calculate(players, results, '2026-02-01');
  // KT1=2.4−0.2+2=4.2. Provisional EU: 3000,2500,2500,2500,
  // then eight 2000s: total 26500, mean 2208.333, KT_EU2=2.2.
  // Therefore KT2=4.4. Winner: floor((4400−2000)/500)=4 pluses -> D3.
  const winner = actual.ranking.find((r) => r.playerId === '1');
  near(actual.tournamentRows[0].meanEuFinal, 26500 / 12);
  near(actual.tournamentRows[0].kt, 4.4);
  assert.equal(winner.currentEu, 3000);
  assert.equal(winner.marks, 0);
  near(winner.t5, 4400 / 5);
  near(winner.rating, 1410);
  assert.equal(actual.isComplete, true);
});

test('provisional pluses and dates never leak into the final pass', () => {
  const { players, results } = fixture();
  players[0].initial_marks = 1;
  const actual = engine().calculate(players, results, '2026-02-01');
  const winner = actual.ranking.find((r) => r.playerId === '1');
  assert.equal(winner.currentEu, 3000);
  assert.equal(winner.marks, 1);
  assert.equal(winner.danDate.toISOString().slice(0, 10), '2026-02-01');
});

test('kyu enters D1 and converts only residual performance to pluses', () => {
  for (const [performance, eu, marks] of [
    [49, 0, 0], [50, 50, 0], [249, 200, 0], [250, 250, 0],
    [1999, 1750, 0], [2000, 2000, 0], [2499, 2000, 0],
    [2500, 2000, 1], [2640, 2000, 1], [3000, 2500, 0], [4000, 3000, 0],
  ]) {
    const result = new EvolutionEngine(config).processPerformance(state(0, 0, null), performance, eventDate);
    assert.deepEqual([result.state.eu, result.state.marks], [eu, marks], `performance=${performance}`);
  }
});

test('dan confirmation without a new plus preserves the existing minus', () => {
  const result = new EvolutionEngine(config).processPerformance(state(3500, -1), 3999, eventDate);
  assert.equal(result.state.eu, 3500);
  assert.equal(result.state.marks, -1);
  assert.equal(result.state.danDate.getTime(), eventDate.getTime());
  assert.equal(result.state.expiryPeriodsApplied, 0);
});

test('a new plus cancels a minus; poor performance does not add a minus', () => {
  const e = new EvolutionEngine(config);
  const success = e.processPerformance(state(3500, -1), 4000, eventDate);
  assert.deepEqual([success.state.eu, success.state.marks], [3500, 0]);
  const failure = e.processPerformance(state(3500, 1), 3499, eventDate);
  assert.deepEqual([failure.state.eu, failure.state.marks], [3500, 1]);
  assert.equal(failure.state.danDate.toISOString().slice(0, 10), '2026-01-01');
});

test('Vitaly: a returning D3− after 500 days enters the tournament as D2', () => {
  const { players, results } = fixture(0, 4, '2025-05-15');
  Object.assign(players[11], { initial_eu: 3000, initial_marks: -1, initial_dan_date: '2024-01-01' });
  const actual = engine().calculate(players, results, '2025-05-15');
  const returning = actual.tournamentRows.find((r) => r.playerId === '12');
  assert.equal(returning.euBefore, 2500);
  assert.equal(returning.euAfter, 2500);
  assert.equal(returning.levelAfter, '2 дан');
});

test('absent players also expire, but changing only the viewing date does not demote', () => {
  const { players, results } = fixture(0, 4, '2025-05-15');
  players.push({ player_id: 'absent', player_name: 'Absent', initial_eu: 3000, initial_marks: -1, initial_dan_date: '2024-01-01' });
  const result = engine().calculate(players, results, '2026-12-31');
  const absent = result.ranking.find((r) => r.playerId === 'absent');
  assert.equal(absent.currentEu, 2500); // One minus at the actual event, not three at viewing time.
  assert.equal(absent.marks, 0);
});

test('expiry anniversary boundaries, no repeated penalties, and D1 protection', () => {
  const e = new EvolutionEngine(config);
  const s = state(3000, 0, '2024-01-01');
  e.applyInactivity(s, new Date('2025-01-01T00:00:00Z'));
  assert.deepEqual([s.eu, s.marks], [3000, 0]);
  e.applyInactivity(s, new Date('2025-01-02T00:00:00Z'));
  assert.deepEqual([s.eu, s.marks], [3000, -1]);
  e.applyInactivity(s, new Date('2025-07-01T00:00:00Z'));
  assert.deepEqual([s.eu, s.marks], [3000, -1]);
  e.applyInactivity(s, new Date('2026-01-01T00:00:00Z'));
  assert.deepEqual([s.eu, s.marks], [2500, 0]);
  e.applyInactivity(s, new Date('2030-01-01T00:00:00Z'));
  assert.deepEqual([s.eu, s.marks], [2000, 0]);
  e.applyInactivity(s, new Date('2040-01-01T00:00:00Z'));
  assert.deepEqual([s.eu, s.marks], [2000, 0]);
});

test('substitutes are excluded from mean EU but remain in N; their own EU stays zero', () => {
  const { players, results } = fixture(2000, 4);
  players[11].initial_eu = 7500;
  results[11].is_substitute = true;
  const actual = engine().calculate(players, results, '2026-02-01');
  near(actual.tournamentRows[0].meanEuFinal, 2000);
  near(actual.tournamentRows[0].kt, 2.2);
  assert.equal(actual.tournamentRows[0].participants, 12);
  assert.equal(actual.ranking.find((r) => r.playerId === '12').currentEu, 0);
});

test('an all-substitute field has a finite zero mean', () => {
  const { players, results } = fixture(2000, 4);
  results.forEach((r) => { r.is_substitute = true; });
  const actual = engine().calculate(players, results, '2026-02-01');
  near(actual.tournamentRows[0].meanEuFinal, 0);
  near(actual.tournamentRows[0].kt, 0.2);
  assert.ok(actual.ranking.every((r) => r.currentEu === 0));
});

test('external known players affect the field; unknown players start at zero', () => {
  const { players, results } = fixture(2000, 4);
  players[0].include_in_rating = false;
  players[11].include_in_rating = false;
  players[11].initial_eu = 0;
  const actual = engine().calculate(players, results, '2026-02-01');
  assert.ok(!actual.ranking.some((r) => r.playerId === '1' || r.playerId === '12'));
  near(actual.tournamentRows[0].meanEuFinal, 22000 / 12);
  near(actual.tournamentRows[0].kt, 2);
});

test('imported expiry counter prevents charging a previously applied anniversary again', () => {
  const { players, results } = fixture(0, 4, '2025-05-15');
  const imported = playersFromCsv('player_id,player_name,initial_eu,initial_marks,initial_dan_date,initial_expiry_periods_applied\n12,Returning,3000,-1,2024-01-01,1')[0];
  players[11] = imported;
  assert.equal(imported.initial_expiry_periods_applied, 1);
  const actual = engine().calculate(players, results, '2025-05-15');
  assert.equal(actual.tournamentRows.find((r) => r.playerId === '12').euBefore, 3000);
  assert.equal(actual.ranking.find((r) => r.playerId === '12').marks, -1);
});

test('history uses the same final states; clean start clears imported expiry and marks', () => {
  const { players, results } = fixture();
  const expected = engine().calculate(players, results, '2026-02-01', { includeAllPlayers: true });
  const snapshots = simulateMcr2026History(players, results, config, {}, 'imported');
  assert.deepEqual(snapshots[0].result.ranking, expected.ranking);
  const dirty = players.map((p) => ({ ...p, initial_marks: -1, initial_expiry_periods_applied: 2 }));
  const clean = simulateMcr2026History(dirty, results, config, {}, 'clean');
  const zeros = players.map((p) => ({ ...p, initial_eu: 0, initial_marks: 0, initial_dan_date: '', initial_expiry_periods_applied: 0 }));
  assert.deepEqual(clean[0].result.ranking, engine().calculate(zeros, results, '2026-02-01').ranking);
});

test('T5 ages at full calendar-month boundaries and always divides by five', () => {
  const e = engine();
  const date = new Date('2023-01-15T00:00:00Z');
  for (const [now, expected] of [['2023-04-14', 1], ['2023-04-15', .92], ['2025-10-15', .12], ['2026-01-14', .12], ['2026-01-15', 0]]) {
    near(e.tournamentWeight(date, new Date(`${now}T00:00:00Z`)), expected);
  }
  const { players, results } = fixture();
  const actual = e.calculate(players, results, '2026-05-01');
  near(actual.ranking.find((r) => r.playerId === '1').t5, 4400 * .92 / 5);
});

test('laboratory weights, coefficients, tables, and rounding-off remain effective', () => {
  const e = engine({ sessionCoef: .2, playerCountScale: 2, euComponentScale: .5, statusTournamentBonus: 2 });
  near(e.tournamentCoefficient(4, 12, 2133, true).kt, .8 - .4 + 1.05 + 2);
  near(engine({ euRoundStep: 0 }).euComponent(2133), 2.133);
  near(engine({}, { ktParticipants: { 12: .3 } }).playerCountComponent(12), .3);
  const { players, results } = fixture();
  const euOnly = engine({ euWeight: 1, t5Weight: 0 }).calculate(players, results, '2026-02-01');
  assert.equal(euOnly.ranking.find((r) => r.playerId === '1').rating, 3000);
  const t3 = engine({ topN: 3, euWeight: 0, t5Weight: 1 }).calculate(players, results, '2026-02-01');
  near(t3.ranking.find((r) => r.playerId === '1').rating, 4400 / 3);
  assert.throws(() => engine({ euWeight: .3 }), /должны быть равны 1/);
});

test('participant counts outside Appendix 2 table do not silently interpolate', () => {
  const { players, results } = fixture();
  const actual = engine().calculate(players, results.map((r) => ({ ...r, participants: 13 })), '2026-02-01');
  assert.equal(actual.isComplete, false);
  assert.equal(actual.skippedTournamentCount, 1);
  assert.equal(actual.processedTournamentCount, 0);
  assert.equal(actual.diagnostics[0].code, 'mcr-participants-not-in-table');
});

test('separate Project MCR retains cumulative B and its original mean/expiry semantics', () => {
  const { players, results } = fixture();
  const actual = new Mcr2026Engine(defaultMcr2026Config()).calculate(players, results, '2026-02-01');
  assert.equal(actual.ranking.find((r) => r.playerId === '1').currentEu, 3500);
  near(actual.tournamentRows[0].kt, 4.4);
  const old = fixture(2000, 4);
  old.results[11].is_substitute = true;
  near(new Mcr2026Engine().calculate(old.players, old.results, '2026-02-01').tournamentRows[0].meanEuFinal, 22000 / 12);
});

test('interactive formula renders without KaTeX errors, including rounding disabled', () => {
  for (const cfg of [config, { ...config, euRoundStep: 0 }, { ...config, doubleStrikeMode: 'B' }, { ...config, doubleStrikeMode: 'none' }, defaultMcr2026Config()]) {
    const html = renderMcr2026Math(cfg);
    assert.ok(!html.includes('katex-error'));
    assert.ok(html.includes('data-formula-token="wEU"'));
    assert.ok(html.includes('data-formula-token="KT_N"'));
  }
});
