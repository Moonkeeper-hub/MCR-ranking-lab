import type { PlayerInput, ResultInput } from "./engine/types";
import { Mcr2026Engine, defaultMcr2026Config } from "./engine/legacy";
import { RrEngine, defaultRrConfig } from "./engine/rr";
import { TrueSkillTournamentEngine, defaultTrueSkillTournamentConfig } from "./engine/trueskillTournament";
import { EloPlEngine, defaultEloPlConfig } from "./engine/eloPl";

export type SeatingType = "random" | "swiss" | "seeded";
export type TournamentScope = "internal" | "external";
export type QualificationMethod = "neutral" | "mcr" | "rr" | "trueskill" | "elo-pl";
export type SubstituteSkillPolicy = "pool-average" | "fixed" | "range";

export interface MockPlayerTemplate {
  id: string;
  baseName: string;
  count: number;
  latentElo: number;
  activity: number;          // 0..1, domestic/internal participation probability
  externalActivity: number;  // 0..1
  consistency: number;       // 0..1; higher means less random variance
  driftPerYear: number;
  activeFrom: string;
  activeTo: string;
  includeInRating: boolean;
  country: string;
  addCharacteristics: boolean;
  initialEu: number;
  initialMarks: number;
  initialDanDate: string;
}

export interface MockTournamentTemplate {
  id: string;
  name: string;
  count: number;
  targetPlayers: number;
  minPlayers: number;
  sessions: number;
  seating: SeatingType;
  scope: TournamentScope;
  isStatus: boolean;
  ratingQuota: number;
  qualificationMethod: QualificationMethod;
  substitutes: number;
  substituteSkillPolicy: SubstituteSkillPolicy;
  substituteFixedElo: number;
  substituteMinElo: number;
  substituteMaxElo: number;
  frequencyPerYear: number;
  months: number[];
  useFixedMonths: boolean;
  skillWeight: number;
  randomness: number;
  roundToFour: boolean;
}

export interface MockGenerationConfig {
  seed: number;
  startDate: string;
  endDate: string;
  neutralAlpha: number;
  basePerformanceSigma: number;
}

export interface GeneratedMockHistory {
  players: PlayerInput[];
  results: ResultInput[];
  manifest: {
    version: string;
    seed: number;
    startDate: string;
    endDate: string;
    generatedAt: string;
    playerTemplateCount: number;
    tournamentTemplateCount: number;
    permanentPlayers: number;
    substitutePlayers: number;
    tournamentsGenerated: number;
    tournamentsCancelled: number;
    resultRows: number;
    config: MockGenerationConfig;
    playerTemplates: MockPlayerTemplate[];
    tournamentTemplates: MockTournamentTemplate[];
  };
}

interface SimPlayer extends PlayerInput {
  latent_elo: number;
  activity: number;
  external_activity: number;
  consistency: number;
  skill_drift_per_year: number;
  active_from: string;
  active_to: string;
  country: string;
}

interface TournamentInstance {
  id: string;
  name: string;
  date: string;
  order: number;
  template: MockTournamentTemplate;
}

interface Participant {
  player: SimPlayer;
  isSubstitute: boolean;
  effectiveElo: number;
}

class SeededRng {
  private state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 0x6d2b79f5; }
  next(): number {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  normal(): number {
    const u = Math.max(1e-12, this.next());
    const v = Math.max(1e-12, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  int(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
  shuffle<T>(input: T[]): T[] {
    const a = [...input];
    for (let i = a.length - 1; i > 0; i--) { const j = this.int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function addDays(d: Date, days: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + days); return x; }
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function parseIso(s: string): Date { return new Date(`${s}T00:00:00Z`); }
function yearsBetween(a: string, b: string): number { return (parseIso(b).getTime() - parseIso(a).getTime()) / (365.2425 * 86400000); }
function safeId(s: string): string { return s.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "item"; }

function adjectiveName(t: MockPlayerTemplate, index: number): string {
  const parts: string[] = [];
  if (t.addCharacteristics) {
    const strength = t.latentElo < 1300 ? "Слабый" : t.latentElo < 1600 ? "Средний" : t.latentElo < 1900 ? "Сильный" : "Очень-сильный";
    const activity = t.activity < 0.3 ? "Редкий" : t.activity < 0.7 ? "Средний" : "Частый";
    const stability = t.consistency >= 0.72 ? "Стабильный" : t.consistency <= 0.35 ? "Нестабильный" : "Обычный";
    parts.push(strength, activity, stability);
    if (t.driftPerYear >= 50) parts.push("Растущий"); else if (t.driftPerYear <= -50) parts.push("Снижающийся");
    if (!t.includeInRating) parts.push("Зарубежный");
  }
  parts.push(t.baseName.trim() || "Игрок");
  if (t.count > 1) parts.push(String(index + 1).padStart(2, "0"));
  return parts.join(" ");
}

export function expandPlayerTemplates(templates: MockPlayerTemplate[]): SimPlayer[] {
  const out: SimPlayer[] = [];
  let serial = 1;
  for (const t of templates) {
    for (let i = 0; i < Math.max(1, Math.floor(t.count)); i++) {
      const id = `MOCK_P${String(serial++).padStart(4, "0")}`;
      out.push({
        player_id: id,
        player_name: adjectiveName(t, i),
        initial_eu: Number(t.initialEu || 0),
        initial_marks: Number(t.initialMarks || 0),
        initial_dan_date: t.initialDanDate || undefined,
        include_in_rating: t.includeInRating,
        latent_elo: Number(t.latentElo),
        activity: clamp(Number(t.activity), 0, 1),
        external_activity: clamp(Number(t.externalActivity), 0, 1),
        consistency: clamp(Number(t.consistency), 0, 1),
        skill_drift_per_year: Number(t.driftPerYear || 0),
        active_from: t.activeFrom,
        active_to: t.activeTo,
        country: t.country || (t.includeInRating ? "RU" : "FOREIGN"),
      });
    }
  }
  return out;
}

function eligibleAt(p: SimPlayer, date: string): boolean {
  if (p.active_from && date < p.active_from) return false;
  if (p.active_to && date > p.active_to) return false;
  return true;
}

function effectiveElo(p: SimPlayer, date: string): number {
  const years = p.active_from ? Math.max(0, yearsBetween(p.active_from, date)) : 0;
  return p.latent_elo + p.skill_drift_per_year * years;
}

function expandTournamentTemplates(templates: MockTournamentTemplate[], cfg: MockGenerationConfig, rng: SeededRng): TournamentInstance[] {
  const startYear = parseIso(cfg.startDate).getUTCFullYear();
  const endYear = parseIso(cfg.endDate).getUTCFullYear();
  const out: TournamentInstance[] = [];
  let serial = 1;
  for (const t of templates) {
    const copies = Math.max(1, Math.floor(t.count));
    const freq = Math.max(1, Math.floor(t.frequencyPerYear));
    for (let copy = 0; copy < copies; copy++) {
      for (let year = startYear; year <= endYear; year++) {
        let months: number[];
        if (t.useFixedMonths && t.months.length) {
          months = [...t.months].slice(0, freq).map(m => clamp(Math.floor(m), 1, 12));
          while (months.length < freq) months.push(clamp(Math.round(((months.length + 0.5) * 12) / freq), 1, 12));
        } else {
          months = Array.from({ length: freq }, (_, i) => clamp(Math.floor(((i + 0.5) * 12) / freq) + rng.int(-1, 1), 1, 12));
        }
        months.forEach((month, occurrence) => {
          const day = rng.int(4, 24);
          const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          if (date < cfg.startDate || date > cfg.endDate) return;
          const suffix = copies > 1 ? ` ${copy + 1}` : "";
          const occurrenceSuffix = freq > 1 ? ` #${occurrence + 1}` : "";
          out.push({ id: `MOCK_T${String(serial++).padStart(5, "0")}`, name: `${t.name}${suffix} ${year}${occurrenceSuffix}`.trim(), date, order: 0, template: t });
        });
      }
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const perDate = new Map<string, number>();
  for (const e of out) { const n = perDate.get(e.date) ?? 0; e.order = n; perDate.set(e.date, n + 1); }
  return out;
}

function rankingMap(method: QualificationMethod, players: SimPlayer[], priorResults: ResultInput[], date: string, neutral: Map<string, number>): Map<string, number> {
  if (method === "neutral") return new Map(neutral);
  try {
    if (method === "mcr") {
      const c = defaultMcr2026Config();
      const r = new Mcr2026Engine(c).calculate(players, priorResults, date);
      return new Map(r.ranking.map(x => [x.playerId, -x.rank]));
    }
    if (method === "rr") {
      const r = new RrEngine(defaultRrConfig()).calculate(players, priorResults, date);
      return new Map(r.ranking.map(x => [x.playerId, -x.rank]));
    }
    if (method === "trueskill") {
      const r = new TrueSkillTournamentEngine(defaultTrueSkillTournamentConfig()).calculate(players, priorResults, date);
      return new Map(r.ranking.map(x => [x.playerId, -x.rank]));
    }
    const r = new EloPlEngine(defaultEloPlConfig()).calculate(players, priorResults, date);
    return new Map(r.ranking.map(x => [x.playerId, -x.rank]));
  } catch {
    // The neutral rating is deliberately the fail-safe mock selector. A method-specific
    // qualification error must not make the synthetic-history generator unusable.
    return new Map(neutral);
  }
}

function makeSubstitute(instance: TournamentInstance, index: number, elo: number): SimPlayer {
  const id = `SUB_${instance.id}_${String(index + 1).padStart(2, "0")}`;
  return {
    player_id: id, player_name: `Замена ${instance.name} ${index + 1}`,
    include_in_rating: false, initial_eu: 0, initial_marks: 0,
    latent_elo: elo, activity: 0, external_activity: 0, consistency: 0.5,
    skill_drift_per_year: 0, active_from: instance.date, active_to: instance.date, country: "SUB",
  };
}

function substituteElo(t: MockTournamentTemplate, permanentPool: SimPlayer[], rng: SeededRng): number {
  if (t.substituteSkillPolicy === "fixed") return t.substituteFixedElo;
  if (t.substituteSkillPolicy === "range") return t.substituteMinElo + rng.next() * Math.max(0, t.substituteMaxElo - t.substituteMinElo);
  if (!permanentPool.length) return 1500;
  return permanentPool.reduce((s, p) => s + p.latent_elo, 0) / permanentPool.length;
}

function weightedAccepted(candidates: SimPlayer[], probability: (p: SimPlayer) => number, rng: SeededRng): SimPlayer[] {
  return rng.shuffle(candidates.filter(p => rng.next() < clamp(probability(p), 0, 1)));
}

function chooseParticipants(instance: TournamentInstance, permanent: SimPlayer[], generatedPlayers: SimPlayer[], priorResults: ResultInput[], neutral: Map<string, number>, rng: SeededRng): Participant[] | null {
  const t = instance.template;
  let target = Math.max(4, Math.floor(t.targetPlayers));
  if (t.roundToFour) target = Math.max(4, Math.round(target / 4) * 4);
  const reserved = Math.min(Math.max(0, Math.floor(t.substitutes)), target);
  const eligible = permanent.filter(p => eligibleAt(p, instance.date));
  const poolMeanSource = eligible.length ? eligible : permanent;
  const participants: Participant[] = [];

  for (let i = 0; i < reserved; i++) {
    const sub = makeSubstitute(instance, i, substituteElo(t, poolMeanSource, rng));
    generatedPlayers.push(sub);
    participants.push({ player: sub, isSubstitute: true, effectiveElo: sub.latent_elo });
  }

  let remaining = target - participants.length;
  const selected = new Set(participants.map(x => String(x.player.player_id)));
  const rated = eligible.filter(p => p.include_in_rating !== false);
  const nonRated = eligible.filter(p => p.include_in_rating === false);

  if (t.isStatus && t.ratingQuota > 0 && remaining > 0) {
    const quota = Math.min(remaining, Math.max(0, Math.floor(t.ratingQuota)));
    const rank = rankingMap(t.qualificationMethod, permanent, priorResults, instance.date, neutral);
    const tie = new Map(rated.map(p => [String(p.player_id), rng.next()]));
    const ordered = [...rated].filter(p => rank.has(String(p.player_id))).sort((a, b) => (rank.get(String(b.player_id)) ?? -1e12) - (rank.get(String(a.player_id)) ?? -1e12) || (tie.get(String(a.player_id))! - tie.get(String(b.player_id))!));
    let taken = 0;
    for (const p of ordered) {
      if (taken >= quota) break;
      const chance = t.scope === "external" ? p.external_activity : p.activity;
      if (rng.next() >= chance) continue;
      participants.push({ player: p, isSubstitute: false, effectiveElo: effectiveElo(p, instance.date) });
      selected.add(String(p.player_id)); taken++; remaining--;
    }
  }

  if (remaining > 0) {
    // External tournaments: only quota-qualified internal players may enter from the
    // internal rating. Every other regular seat is drawn from non-rated/foreign players.
    const openPool = t.scope === "external" ? nonRated : rated;
    const accepted = weightedAccepted(openPool.filter(p => !selected.has(String(p.player_id))), p => t.scope === "external" ? p.external_activity : p.activity, rng);
    for (const p of accepted.slice(0, remaining)) {
      participants.push({ player: p, isSubstitute: false, effectiveElo: effectiveElo(p, instance.date) });
      selected.add(String(p.player_id)); remaining--;
    }
  }

  if (remaining > 0 && t.scope === "external") {
    // Foreign pool exhausted: fill every remaining seat with a one-use substitute.
    const startIndex = reserved;
    for (let i = 0; i < remaining; i++) {
      const sub = makeSubstitute(instance, startIndex + i, substituteElo(t, poolMeanSource, rng));
      generatedPlayers.push(sub);
      participants.push({ player: sub, isSubstitute: true, effectiveElo: sub.latent_elo });
    }
    remaining = 0;
  }

  if (participants.length < Math.max(4, Math.floor(t.minPlayers))) return null;
  return participants;
}

function performanceNoiseSd(p: SimPlayer, t: MockTournamentTemplate, baseSigma: number): number {
  const personal = 0.25 + (1 - clamp(p.consistency, 0, 1)) * 1.25;
  // More sessions already reduce variance by aggregating more independent rounds.
  // Do not divide the per-round noise by sqrt(sessions) again: that would count
  // tournament length twice.
  return Math.max(1, baseSigma * personal * Math.max(0.05, t.randomness));
}

function seatRound(participants: Participant[], standings: Map<string, { points: number; raw: number; places: number; rounds: number }>, type: SeatingType, round: number, rng: SeededRng): Participant[][] {
  let ordered: Participant[];
  if (type === "random") ordered = rng.shuffle(participants);
  else if (type === "seeded" && round === 0) {
    const sorted = [...participants].sort((a, b) => b.effectiveElo - a.effectiveElo);
    const tables = Math.ceil(sorted.length / 4); const distributed: Participant[] = [];
    for (let seed = 0; seed < 4; seed++) {
      const slice = sorted.slice(seed * tables, (seed + 1) * tables);
      if (seed % 2 === 1) slice.reverse();
      slice.forEach((p, i) => { distributed[i * 4 + seed] = p; });
    }
    ordered = distributed.filter(Boolean);
  } else {
    ordered = [...participants].sort((a, b) => {
      const sa = standings.get(String(a.player.player_id))!, sb = standings.get(String(b.player.player_id))!;
      return sb.points - sa.points || sb.raw - sa.raw || rng.next() - 0.5;
    });
  }
  const groups: Participant[][] = [];
  for (let i = 0; i < ordered.length; i += 4) groups.push(ordered.slice(i, i + 4));
  return groups;
}

function simulatePlaces(participants: Participant[], t: MockTournamentTemplate, cfg: MockGenerationConfig, rng: SeededRng): Map<string, number> {
  const standings = new Map<string, { points: number; raw: number; places: number; rounds: number }>();
  participants.forEach(p => standings.set(String(p.player.player_id), { points: 0, raw: 0, places: 0, rounds: 0 }));
  const sessions = Math.max(1, Math.floor(t.sessions));
  const pointScale = [4, 2, 1, 0];
  for (let round = 0; round < sessions; round++) {
    for (const table of seatRound(participants, standings, t.seating, round, rng)) {
      const perf = table.map(p => ({ p, value: p.effectiveElo * Math.max(0, t.skillWeight) + rng.normal() * performanceNoiseSd(p.player, t, cfg.basePerformanceSigma) }))
        .sort((a, b) => b.value - a.value);
      perf.forEach((x, idx) => {
        const s = standings.get(String(x.p.player.player_id))!;
        s.points += pointScale[Math.min(idx, pointScale.length - 1)] ?? 0;
        s.raw += x.value;
        s.places += idx + 1;
        s.rounds += 1;
      });
    }
  }
  const ordered = [...participants].sort((a, b) => {
    const sa = standings.get(String(a.player.player_id))!, sb = standings.get(String(b.player.player_id))!;
    return sb.points - sa.points || sb.raw - sa.raw || (sa.places / Math.max(1, sa.rounds)) - (sb.places / Math.max(1, sb.rounds)) || String(a.player.player_id).localeCompare(String(b.player.player_id));
  });
  return new Map(ordered.map((p, i) => [String(p.player.player_id), i + 1]));
}

function updateNeutralRating(neutral: Map<string, number>, rows: ResultInput[], alpha: number): void {
  for (const r of rows) {
    if (r.is_substitute) continue;
    const n = Math.max(2, Number(r.participants));
    const score = 1000 * (n - Number(r.place)) / (n - 1);
    const old = neutral.get(String(r.player_id)) ?? 500;
    neutral.set(String(r.player_id), (1 - alpha) * old + alpha * score);
  }
}

export function generateMockHistory(playerTemplates: MockPlayerTemplate[], tournamentTemplates: MockTournamentTemplate[], cfg: MockGenerationConfig): GeneratedMockHistory {
  const rng = new SeededRng(cfg.seed);
  const permanent = expandPlayerTemplates(playerTemplates);
  const allPlayers: SimPlayer[] = permanent.map(p => ({ ...p }));
  const instances = expandTournamentTemplates(tournamentTemplates, cfg, rng);
  const results: ResultInput[] = [];
  const neutral = new Map<string, number>();
  let cancelled = 0;
  let generated = 0;

  for (const instance of instances) {
    const participants = chooseParticipants(instance, permanent, allPlayers, results, neutral, rng);
    if (!participants) { cancelled++; continue; }
    const t = instance.template;
    const places = simulatePlaces(participants, t, cfg, rng);
    const n = participants.length;
    const rows: ResultInput[] = participants.map(p => ({
      tournament_id: instance.id,
      tournament_name: instance.name,
      tournament_date: instance.date,
      tournament_order: instance.order,
      tournament_type: t.scope,
      player_id: String(p.player.player_id),
      place: places.get(String(p.player.player_id))!,
      participants: n,
      sessions: Math.max(1, Math.floor(t.sessions)),
      is_status_tournament: Boolean(t.isStatus),
      is_substitute: p.isSubstitute,
    }));
    rows.sort((a, b) => a.place - b.place);
    results.push(...rows);
    updateNeutralRating(neutral, rows, clamp(cfg.neutralAlpha, 0, 1));
    generated++;
  }

  return {
    players: allPlayers.map(p => ({ ...p })),
    results,
    manifest: {
      version: "mock-generator-v1",
      seed: cfg.seed, startDate: cfg.startDate, endDate: cfg.endDate,
      generatedAt: new Date().toISOString(),
      playerTemplateCount: playerTemplates.length,
      tournamentTemplateCount: tournamentTemplates.length,
      permanentPlayers: permanent.length,
      substitutePlayers: allPlayers.length - permanent.length,
      tournamentsGenerated: generated,
      tournamentsCancelled: cancelled,
      resultRows: results.length,
      config: { ...cfg },
      playerTemplates: playerTemplates.map(x => ({ ...x })),
      tournamentTemplates: tournamentTemplates.map(x => ({ ...x, months: [...x.months] })),
    },
  };
}
