import { EvolutionEngine, levelLabel } from "./evolution";
import { KT_PARTICIPANTS, LEGACY_AGE_WEIGHTS, LEGACY_DEFAULTS } from "./legacyTables";
import type {
  AgeWeight,
  CalculationResult,
  EvolutionState,
  LegacyConfig,
  PlayerInput,
  RankingRow,
  ResultInput,
  TableOverrides,
  TournamentDetail,
} from "./types";

function parseDate(value: string | Date): Date {
  if (value instanceof Date) return new Date(value);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Некорректная дата: ${value}`);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return a?.getTime() === b?.getTime();
}

export function defaultLegacyConfig(): LegacyConfig {
  return { ...LEGACY_DEFAULTS };
}

export class LegacyEngine {
  readonly config: LegacyConfig;
  readonly ktParticipants: Record<number, number>;
  readonly ageWeights?: AgeWeight[];
  readonly evolution: EvolutionEngine;

  constructor(config: Partial<LegacyConfig> = {}, overrides: TableOverrides = {}) {
    this.config = { ...LEGACY_DEFAULTS, ...config };
    if (Math.abs(this.config.euWeight + this.config.t5Weight - 1) > 1e-9) {
      throw new Error("Legacy: euWeight + t5Weight должны быть равны 1");
    }
    this.ktParticipants = { ...KT_PARTICIPANTS, ...(overrides.ktParticipants ?? {}) };
    this.ageWeights = overrides.ageWeights?.map((x) => ({ ...x }));
    this.evolution = new EvolutionEngine(this.config);
  }

  normRating(place: number, participants: number): number {
    if (participants <= 1) throw new Error("participants должен быть > 1");
    if (place < 1 || place > participants) throw new Error("place должен быть от 1 до participants");
    return (1000 * (participants - place)) / (participants - 1);
  }

  playerCountComponent(participants: number): number {
    const keys = Object.keys(this.ktParticipants).map(Number).sort((a, b) => a - b);
    const exact = this.ktParticipants[participants];
    if (exact !== undefined) return exact * this.config.playerCountScale;

    if (participants < keys[0]) return this.ktParticipants[keys[0]] * this.config.playerCountScale;
    if (participants > keys[keys.length - 1]) {
      if (this.config.capPlayerCountComponent) {
        return this.ktParticipants[keys[keys.length - 1]] * this.config.playerCountScale;
      }
      throw new Error(`Для ${participants} участников в Legacy-таблице нет значения`);
    }

    const lower = [...keys].reverse().find((x) => x < participants)!;
    const upper = keys.find((x) => x > participants)!;
    const y0 = this.ktParticipants[lower];
    const y1 = this.ktParticipants[upper];
    const base = y0 + (y1 - y0) * ((participants - lower) / (upper - lower));
    return base * this.config.playerCountScale;
  }

  euComponent(meanEu: number): number {
    const raw = (meanEu / this.config.euNormalizer) * this.config.euComponentScale;
    if (this.config.euRoundStep <= 0) return raw;
    return Math.floor((raw + 1e-12) / this.config.euRoundStep) * this.config.euRoundStep;
  }

  tournamentCoefficient(sessions: number, participants: number, meanEu: number, isWorldEurope: boolean) {
    const ktSessions = sessions * this.config.sessionCoef;
    const ktPlayers = this.playerCountComponent(participants);
    const ktEu = this.euComponent(meanEu);
    const ktWorld = isWorldEurope ? this.config.worldEuropeBonus : 0;
    return { ktSessions, ktPlayers, ktEu, ktWorld, kt: ktSessions + ktPlayers + ktEu + ktWorld };
  }

  ageMonths(tournamentDate: Date, evaluationDate: Date): number {
    let months = (evaluationDate.getUTCFullYear() - tournamentDate.getUTCFullYear()) * 12
      + (evaluationDate.getUTCMonth() - tournamentDate.getUTCMonth());
    if (evaluationDate.getUTCDate() < tournamentDate.getUTCDate()) months -= 1;
    return Math.max(0, months);
  }

  tournamentWeight(tournamentDate: Date, evaluationDate: Date): number {
    const months = this.ageMonths(tournamentDate, evaluationDate);
    const lookup = this.ageWeights ?? (
      this.config.decayPerQuarter === 0.08 && this.config.maxAgeMonths === 36
        ? LEGACY_AGE_WEIGHTS
        : undefined
    );
    if (lookup) {
      const found = lookup.find((x) => months >= x.minMonths && (x.maxMonths === null || months <= x.maxMonths));
      if (found) return found.weight;
    }
    if (months >= this.config.maxAgeMonths) return 0;
    return Math.max(0, 1 - this.config.decayPerQuarter * Math.floor(months / 3));
  }

  calculate(playersInput: PlayerInput[], resultsInput: ResultInput[], evaluationDateInput: string | Date): CalculationResult {
    const evaluationDate = parseDate(evaluationDateInput);
    const players = playersInput.map((p) => ({
      ...p,
      player_id: String(p.player_id),
      initial_eu: Number(p.initial_eu ?? 0),
      initial_marks: Number(p.initial_marks ?? 0),
      initial_dan_date: String(p.initial_dan_date ?? ""),
    }));
    const results = resultsInput.map((r) => ({
      ...r,
      player_id: String(r.player_id),
      tournament_order: Number(r.tournament_order ?? 0),
      place: Number(r.place),
      participants: Number(r.participants),
      sessions: Number(r.sessions),
      is_world_europe: Boolean(r.is_world_europe),
    }));

    const states = new Map<string, EvolutionState>();
    const names = new Map<string, string>();
    for (const p of players) {
      states.set(p.player_id, {
        eu: Math.trunc(Number(p.initial_eu || 0)),
        marks: Math.trunc(Number(p.initial_marks || 0)),
        danDate: p.initial_dan_date ? parseDate(p.initial_dan_date) : null,
      });
      names.set(p.player_id, p.player_name);
    }
    for (const row of results) {
      if (!states.has(row.player_id)) states.set(row.player_id, { eu: 0, marks: 0, danDate: null });
    }

    const metaMap = new Map<string, ResultInput>();
    for (const r of results) if (!metaMap.has(r.tournament_id)) metaMap.set(r.tournament_id, r);
    const tournamentMeta = [...metaMap.values()].sort((a, b) => {
      const da = parseDate(a.tournament_date).getTime();
      const db = parseDate(b.tournament_date).getTime();
      if (da !== db) return da - db;
      const oa = Number(a.tournament_order ?? 0), ob = Number(b.tournament_order ?? 0);
      if (oa !== ob) return oa - ob;
      return String(a.tournament_id).localeCompare(String(b.tournament_id));
    });

    const details: TournamentDetail[] = [];

    for (const t of tournamentMeta) {
      const tdate = parseDate(t.tournament_date);
      const sub = results.filter((r) => r.tournament_id === t.tournament_id);

      for (const state of states.values()) this.evolution.expireUntil(state, tdate);

      const euBefore = new Map([...states.entries()].map(([pid, st]) => [pid, st.eu]));
      const participantEus = sub.map((r) => states.get(r.player_id)!.eu);
      const meanEuPass1 = participantEus.length ? participantEus.reduce((a, b) => a + b, 0) / participantEus.length : 0;
      const kt1 = this.tournamentCoefficient(t.sessions, t.participants, meanEuPass1, t.is_world_europe);
      const processedNorm = new Map(sub.map((r) => [r.player_id, 0]));

      for (const row of sub) {
        const nr = this.normRating(row.place, row.participants);
        const perf = nr * kt1.kt;
        const pid = row.player_id;
        const action = this.evolution.processPerformance(states.get(pid)!, perf, tdate, 0);
        processedNorm.set(pid, action.processedNorm);
      }

      let meanEuFinal = meanEuPass1;
      let ktFinal = kt1;
      if (this.config.doubleStrike) {
        const participantEus2 = sub.map((r) => states.get(r.player_id)!.eu);
        meanEuFinal = participantEus2.length ? participantEus2.reduce((a, b) => a + b, 0) / participantEus2.length : 0;
        ktFinal = this.tournamentCoefficient(t.sessions, t.participants, meanEuFinal, t.is_world_europe);
        for (const row of sub) {
          const nr = this.normRating(row.place, row.participants);
          const perf = nr * ktFinal.kt;
          const pid = row.player_id;
          const action = this.evolution.processPerformance(states.get(pid)!, perf, tdate, processedNorm.get(pid) ?? 0);
          processedNorm.set(pid, action.processedNorm);
        }
      }

      const vt = this.tournamentWeight(tdate, evaluationDate);
      for (const row of sub) {
        const pid = row.player_id;
        const nr = this.normRating(row.place, row.participants);
        const nrkt = nr * ktFinal.kt;
        details.push({
          tournamentId: row.tournament_id,
          tournamentName: row.tournament_name,
          tournamentDate: isoDate(tdate),
          playerId: pid,
          place: row.place,
          participants: row.participants,
          sessions: row.sessions,
          euBefore: euBefore.get(pid) ?? 0,
          euAfter: states.get(pid)!.eu,
          levelAfter: levelLabel(states.get(pid)!.eu, states.get(pid)!.marks),
          meanEuFinal,
          ktSessions: ktFinal.ktSessions,
          ktPlayers: ktFinal.ktPlayers,
          ktEu: ktFinal.ktEu,
          ktWorld: ktFinal.ktWorld,
          kt: ktFinal.kt,
          nr,
          vt,
          nrkt,
          nrktvt: nrkt * vt,
        });
      }
    }

    for (const state of states.values()) this.evolution.expireUntil(state, evaluationDate);

    const ranking: RankingRow[] = [];
    for (const [pid, state] of states.entries()) {
      const playerRows = details.filter((x) => x.playerId === pid).sort((a, b) => b.nrktvt - a.nrktvt);
      const top = playerRows.slice(0, this.config.topN);
      const t5 = this.config.topN > 0 ? top.reduce((sum, x) => sum + x.nrktvt, 0) / this.config.topN : 0;
      ranking.push({
        rank: 0,
        playerId: pid,
        playerName: names.get(pid) ?? pid,
        currentEu: state.eu,
        marks: state.marks,
        level: levelLabel(state.eu, state.marks),
        danDate: state.danDate,
        t5,
        rating: this.config.euWeight * state.eu + this.config.t5Weight * t5,
        tournamentsCount: playerRows.length,
      });
    }

    ranking.sort((a, b) => b.rating - a.rating || a.playerName.localeCompare(b.playerName, "ru"));
    ranking.forEach((row, i) => { row.rank = i + 1; });
    return { ranking, tournamentRows: details };
  }
}
