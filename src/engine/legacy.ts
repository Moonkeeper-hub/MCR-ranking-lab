import { EvolutionEngine, cloneState, levelLabel } from "./evolution";
import { KT_PARTICIPANTS, MCR2026_AGE_WEIGHTS, MCR2026_DEFAULTS } from "./legacyTables";
import type {
  AgeWeight,
  CalculationResult,
  CalculationOptions,
  EvolutionState,
  Mcr2026Config,
  PlayerInput,
  RankingRow,
  ResultInput,
  TableOverrides,
  TournamentDetail,
  MethodDiagnostic,
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

function cloneStates(states: Map<string, EvolutionState>): Map<string, EvolutionState> {
  return new Map(
    [...states.entries()].map(([pid, state]) => [pid, cloneState(state)]),
  );
}

export function defaultMcr2026Config(): Mcr2026Config {
  return { ...MCR2026_DEFAULTS };
}


/**
 * Legacy MCR (Novikov observed).
 *
 * Reverse-engineered defaults from published before/after rating snapshots.
 * This is deliberately separate from the literal Appendix 3 implementation.
 */
export function defaultObservedMcrConfig(): Mcr2026Config {
  return {
    ...MCR2026_DEFAULTS,
    doubleStrikeMode: "A",
    doubleStrikeScope: "newcomers_only",
    substituteEuPolicy: "zero",
    evolutionPolicy: "novikov_observed",
    capKyuPromotionAtFirstDan: false,
  };
}

export class Mcr2026Engine {
  readonly config: Mcr2026Config;
  readonly ktParticipants: Record<number, number>;
  readonly ageWeights?: AgeWeight[];
  readonly evolution: EvolutionEngine;

  constructor(config: Partial<Mcr2026Config> = {}, overrides: TableOverrides = {}) {
    this.config = { ...MCR2026_DEFAULTS, ...config };
    if (Math.abs(this.config.euWeight + this.config.t5Weight - 1) > 1e-9) {
      throw new Error("Project MCR: euWeight + t5Weight должны быть равны 1");
    }
    this.ktParticipants = { ...KT_PARTICIPANTS, ...(overrides.ktParticipants ?? {}) };
    this.ageWeights = overrides.ageWeights?.map((x) => ({ ...x }));
    this.evolution = new EvolutionEngine(this.config);
  }

  normRating(place: number, participants: number): number {
    if (participants <= 1) throw new Error("participants должен быть > 1");
    if (place < 1 || place > participants) {
      throw new Error(`Некорректное место ${place} при ЧУТ=${participants}`);
    }
    return (1000 * (participants - place)) / (participants - 1);
  }

  playerCountComponent(participants: number): number {
    const exact = this.ktParticipants[participants];
    if (exact !== undefined) return exact * this.config.playerCountScale;

    const keys = Object.keys(this.ktParticipants).map(Number).sort((a, b) => a - b);
    if (!keys.length) throw new Error("Project MCR: таблица KT_ЧУТ пуста");

    if (this.config.participantCountPolicy === "strict" || this.config.participantCountPolicy === "skip") {
      throw new Error(`Project MCR: ЧУТ=${participants} отсутствует в нормативной таблице KT_ЧУТ`);
    }

    const lower = [...keys].reverse().find((x) => x < participants);
    const upper = keys.find((x) => x > participants);

    if (this.config.participantCountPolicy === "lower") {
      const key = lower ?? keys[0];
      return this.ktParticipants[key] * this.config.playerCountScale;
    }

    if (this.config.participantCountPolicy === "nearest") {
      if (lower === undefined) return this.ktParticipants[keys[0]] * this.config.playerCountScale;
      if (upper === undefined) return this.ktParticipants[keys[keys.length - 1]] * this.config.playerCountScale;
      const key = (participants - lower) <= (upper - participants) ? lower : upper;
      return this.ktParticipants[key] * this.config.playerCountScale;
    }

    // Linear interpolation between the neighboring normative rows. Outside
    // the table range we clamp to the nearest endpoint rather than extrapolate.
    if (lower === undefined) return this.ktParticipants[keys[0]] * this.config.playerCountScale;
    if (upper === undefined) return this.ktParticipants[keys[keys.length - 1]] * this.config.playerCountScale;
    const y0 = this.ktParticipants[lower];
    const y1 = this.ktParticipants[upper];
    const t = (participants - lower) / (upper - lower);
    return (y0 + (y1 - y0) * t) * this.config.playerCountScale;
  }

  euComponent(meanEu: number): number {
    const raw = (meanEu / this.config.euNormalizer) * this.config.euComponentScale;
    if (this.config.euRoundStep <= 0) return raw;
    return Math.floor((raw + 1e-12) / this.config.euRoundStep) * this.config.euRoundStep;
  }

  tournamentCoefficient(
    sessions: number,
    participants: number,
    meanEu: number,
    isStatusTournament: boolean,
  ) {
    const ktSessions = sessions * this.config.sessionCoef;
    const ktPlayers = this.playerCountComponent(participants);
    const ktEu = this.euComponent(meanEu);
    const ktStatus = isStatusTournament ? this.config.statusTournamentBonus : 0;
    return {
      ktSessions,
      ktPlayers,
      ktEu,
      ktStatus,
      kt: ktSessions + ktPlayers + ktEu + ktStatus,
    };
  }

  ageMonths(tournamentDate: Date, evaluationDate: Date): number {
    let months =
      (evaluationDate.getUTCFullYear() - tournamentDate.getUTCFullYear()) * 12
      + (evaluationDate.getUTCMonth() - tournamentDate.getUTCMonth());
    if (evaluationDate.getUTCDate() < tournamentDate.getUTCDate()) months -= 1;
    return Math.max(0, months);
  }

  tournamentWeight(tournamentDate: Date, evaluationDate: Date): number {
    const months = this.ageMonths(tournamentDate, evaluationDate);
    const lookup = this.ageWeights ?? (
      this.config.decayPerQuarter === 0.08 && this.config.maxAgeMonths === 36
        ? MCR2026_AGE_WEIGHTS
        : undefined
    );

    if (lookup) {
      const found = lookup.find(
        (x) => months >= x.minMonths && (x.maxMonths === null || months <= x.maxMonths),
      );
      if (found) return found.weight;
    }

    if (months >= this.config.maxAgeMonths) return 0;
    return Math.max(
      0,
      1 - this.config.decayPerQuarter * Math.floor(months / 3),
    );
  }

  private meanTournamentEu(
    rows: ResultInput[],
    states: Map<string, EvolutionState>,
    provisionalEu: Map<string, number> = new Map(),
    secondPass = false,
  ): number {
    const nonSubRows = rows.filter((row) => !row.is_substitute);

    const euFor = (row: ResultInput): number => {
      const pid = row.player_id;
      if (provisionalEu.has(pid)) return provisionalEu.get(pid)!;

      if (row.is_substitute) {
        if (this.config.substituteEuPolicy === "zero") return 0;
        if (this.config.substituteEuPolicy === "newcomer" && !secondPass) return 0;
      }

      return states.get(pid)?.eu ?? 0;
    };

    let substituteAverage = 0;
    if (this.config.substituteEuPolicy === "average" && nonSubRows.length) {
      substituteAverage =
        nonSubRows.reduce((sum, row) => sum + euFor(row), 0) / nonSubRows.length;
    }

    const values = rows.map((row) => {
      if (row.is_substitute && this.config.substituteEuPolicy === "average") {
        return substituteAverage;
      }
      return euFor(row);
    });

    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  }

  private applyTournamentPass(
    rows: ResultInput[],
    states: Map<string, EvolutionState>,
    kt: number,
    tournamentDate: Date,
  ): void {
    for (const row of rows) {
      const state = states.get(row.player_id);
      if (!state) continue;

      // Appendix 3 v0.5 default: a substitute has immutable EU=0.
      // Alternative substitute policies remain available as laboratory
      // experiments and keep the previous evolutionary behaviour.
      if (row.is_substitute && this.config.substituteEuPolicy === "zero") {
        state.eu = 0;
        state.marks = 0;
        state.danDate = null;
        state.expiryPeriodsApplied = 0;
        continue;
      }

      const nr = this.normRating(row.place, row.participants);
      this.evolution.processPerformance(state, nr * kt, tournamentDate);
    }
  }

  private enforceKyuPromotionCap(
    states: Map<string, EvolutionState>,
    euBeforeTournament: Map<string, number>,
    participantIds: Iterable<string>,
    tournamentDate: Date,
  ): void {
    if (!this.config.capKyuPromotionAtFirstDan) return;
    for (const pid of participantIds) {
      if ((euBeforeTournament.get(pid) ?? 0) > 1750) continue;
      const state = states.get(pid);
      if (!state) continue;
      if (state.eu > 2000 || (state.eu === 2000 && state.marks > 0)) {
        state.eu = 2000;
        state.marks = 0;
        state.danDate = tournamentDate;
        state.expiryPeriodsApplied = 0;
      }
    }
  }

  private participantCountDiagnostic(row: ResultInput): MethodDiagnostic | null {
    const participants = Number(row.participants);
    if (this.ktParticipants[participants] !== undefined) return null;
    return {
      level: this.config.participantCountPolicy === "strict" ? "error" : "warning",
      code: "mcr-participants-not-in-table",
      message: `ЧУТ=${participants} отсутствует в нормативной таблице KT_ЧУТ`,
      tournamentId: String(row.tournament_id),
      tournamentName: String(row.tournament_name),
      tournamentDate: String(row.tournament_date),
    };
  }

  calculate(
    playersInput: PlayerInput[],
    resultsInput: ResultInput[],
    evaluationDateInput: string | Date,
    options: CalculationOptions = {},
  ): CalculationResult {
    const evaluationDate = parseDate(evaluationDateInput);

    // Historical cutoff: future tournaments do not exist for this calculation.
    const normalizedResults = resultsInput
      .map((r) => ({
        ...r,
        player_id: String(r.player_id),
        tournament_order: Number(r.tournament_order ?? 0),
        place: Number(r.place),
        participants: Number(r.participants),
        sessions: Number(r.sessions),
        is_status_tournament: Boolean(r.is_status_tournament),
        is_substitute: Boolean(r.is_substitute),
      }))
      .filter((r) => parseDate(r.tournament_date).getTime() <= evaluationDate.getTime());

    const diagnostics: MethodDiagnostic[] = [];
    const invalidTournamentKeys = new Set<string>();
    const seenTournamentKeys = new Set<string>();
    for (const row of normalizedResults) {
      const key = `${row.tournament_date}\u0000${row.tournament_order ?? 0}\u0000${row.tournament_id}`;
      if (seenTournamentKeys.has(key)) continue;
      seenTournamentKeys.add(key);
      const diagnostic = this.participantCountDiagnostic(row);
      if (diagnostic) {
        diagnostics.push(diagnostic);
        if (this.config.participantCountPolicy === "strict" || this.config.participantCountPolicy === "skip") {
          invalidTournamentKeys.add(key);
        }
      }
    }

    const results = normalizedResults.filter((row) => {
      const key = `${row.tournament_date}\u0000${row.tournament_order ?? 0}\u0000${row.tournament_id}`;
      return !invalidTournamentKeys.has(key);
    });

    const activePlayerIds = new Set(results.map((r) => r.player_id));
    const players = playersInput
      .map((p) => ({
        ...p,
        player_id: String(p.player_id),
        initial_eu: Number(p.initial_eu ?? 0),
        initial_marks: Number(p.initial_marks ?? 0),
        initial_dan_date: String(p.initial_dan_date ?? ""),
        include_in_rating: p.include_in_rating !== false,
      }))
      .filter((p) => {
        if (options.includeAllPlayers) return true;
        const hasInitialState =
          Number(p.initial_eu ?? 0) !== 0
          || Number(p.initial_marks ?? 0) !== 0
          || Boolean(String(p.initial_dan_date ?? "").trim());
        return hasInitialState || activePlayerIds.has(p.player_id);
      });

    const states = new Map<string, EvolutionState>();
    const names = new Map<string, string>();
    const includeInRanking = new Map<string, boolean>();
    const knownPlayers = new Set<string>();

    for (const p of players) {
      const marks = Math.trunc(Number(p.initial_marks || 0));
      states.set(p.player_id, {
        eu: Math.trunc(Number(p.initial_eu || 0)),
        marks,
        danDate: p.initial_dan_date ? parseDate(p.initial_dan_date) : null,
        // In MCR-2026 minuses come from inactivity, so an imported minus
        // represents one already-applied inactivity period.
        expiryPeriodsApplied: marks < 0 ? 1 : 0,
      });
      names.set(p.player_id, p.player_name);
      includeInRanking.set(p.player_id, p.include_in_rating !== false);

      const hasInitialState =
        Number(p.initial_eu ?? 0) !== 0
        || marks !== 0
        || Boolean(String(p.initial_dan_date ?? "").trim());

      if (options.includeAllPlayers || hasInitialState) {
        knownPlayers.add(p.player_id);
      }
    }

    for (const row of results) {
      if (!states.has(row.player_id)) {
        states.set(row.player_id, {
          eu: 0,
          marks: 0,
          danDate: null,
          expiryPeriodsApplied: 0,
        });
        includeInRanking.set(row.player_id, true);
      }
    }

    const metaMap = new Map<string, ResultInput>();
    for (const r of results) {
      const key = `${r.tournament_date}\u0000${r.tournament_order ?? 0}\u0000${r.tournament_id}`;
      if (!metaMap.has(key)) metaMap.set(key, r);
    }

    const tournamentMeta = [...metaMap.values()].sort((a, b) => {
      const da = parseDate(a.tournament_date).getTime();
      const db = parseDate(b.tournament_date).getTime();
      if (da !== db) return da - db;
      const oa = Number(a.tournament_order ?? 0);
      const ob = Number(b.tournament_order ?? 0);
      if (oa !== ob) return oa - ob;
      return String(a.tournament_id).localeCompare(String(b.tournament_id));
    });

    const details: TournamentDetail[] = [];

    for (const t of tournamentMeta) {
      const tdate = parseDate(t.tournament_date);
      const sub = results.filter(
        (r) =>
          r.tournament_id === t.tournament_id
          && r.tournament_date === t.tournament_date
          && Number(r.tournament_order ?? 0) === Number(t.tournament_order ?? 0),
      );

      if (!sub.length) continue;

      const participantIds = new Set(sub.map((row) => row.player_id));

      // Appendix 3: inactivity is checked only for rated players who are NOT
      // participating in the tournament currently being processed.
      for (const [pid, state] of states.entries()) {
        if (!participantIds.has(pid)) {
          this.evolution.applyInactivity(state, tdate);
        }
      }

      const euBefore = new Map(
        [...states.entries()].map(([pid, state]) => [pid, state.eu]),
      );

      const newcomerIds = new Set(
        sub
          .map((row) => row.player_id)
          .filter((pid) => !knownPlayers.has(pid)),
      );

      const substituteAsNewcomerIds = new Set(
        this.config.substituteEuPolicy === "newcomer"
          ? sub.filter((row) => row.is_substitute).map((row) => row.player_id)
          : [],
      );

      const newcomerDoubleStrikeIds = new Set([
        ...newcomerIds,
        ...substituteAsNewcomerIds,
      ]);

      // Appendix 3 v0.5 default: double calculation is performed for every
      // processed tournament. "newcomers_only" is retained as a laboratory
      // compatibility experiment.
      const doubleStrikeIds = this.config.doubleStrikeScope === "every_tournament"
        ? new Set(participantIds)
        : newcomerDoubleStrikeIds;

      const shouldDoubleStrike =
        this.config.doubleStrikeMode !== "none"
        && (
          this.config.doubleStrikeScope === "every_tournament"
          || doubleStrikeIds.size > 0
        );

      const meanEuPass1 = this.meanTournamentEu(sub, states);
      const kt1 = this.tournamentCoefficient(
        t.sessions,
        t.participants,
        meanEuPass1,
        t.is_status_tournament,
      );

      let meanEuFinal = meanEuPass1;
      let ktFinal = kt1;

      if (!shouldDoubleStrike) {
        this.applyTournamentPass(sub, states, kt1.kt, tdate);
        this.enforceKyuPromotionCap(states, euBefore, participantIds, tdate);
      } else if (this.config.doubleStrikeMode === "A") {
        // Variant A: pass 1 is provisional. It is used only to obtain the
        // updated EU of newcomers/replacements for KT_EU. Final rank changes
        // are recalculated once from the original pre-tournament state.
        const provisionalStates = cloneStates(states);
        this.applyTournamentPass(sub, provisionalStates, kt1.kt, tdate);
        this.enforceKyuPromotionCap(provisionalStates, euBefore, participantIds, tdate);

        const provisionalEu = new Map<string, number>();
        for (const pid of doubleStrikeIds) {
          provisionalEu.set(pid, provisionalStates.get(pid)?.eu ?? 0);
        }

        meanEuFinal = this.meanTournamentEu(
          sub,
          states,
          provisionalEu,
          true,
        );
        ktFinal = this.tournamentCoefficient(
          t.sessions,
          t.participants,
          meanEuFinal,
          t.is_status_tournament,
        );

        this.applyTournamentPass(sub, states, ktFinal.kt, tdate);
        this.enforceKyuPromotionCap(states, euBefore, participantIds, tdate);
      } else {
        // Variant B (MCR-2026 default): pass 2 continues from the state
        // produced by pass 1. Positive changes caused by the second iteration
        // are therefore applied again, as required by Appendix 3 v0.5.
        this.applyTournamentPass(sub, states, kt1.kt, tdate);
        this.enforceKyuPromotionCap(states, euBefore, participantIds, tdate);

        meanEuFinal = this.meanTournamentEu(sub, states, new Map(), true);
        ktFinal = this.tournamentCoefficient(
          t.sessions,
          t.participants,
          meanEuFinal,
          t.is_status_tournament,
        );

        this.applyTournamentPass(sub, states, ktFinal.kt, tdate);
        this.enforceKyuPromotionCap(states, euBefore, participantIds, tdate);
      }

      const vt = this.tournamentWeight(tdate, evaluationDate);

      for (const row of sub) {
        const pid = row.player_id;
        const nr = this.normRating(row.place, row.participants);
        const nrkt = nr * ktFinal.kt;
        const state = states.get(pid)!;

        details.push({
          tournamentId: row.tournament_id,
          tournamentName: row.tournament_name,
          tournamentDate: isoDate(tdate),
          playerId: pid,
          place: row.place,
          participants: row.participants,
          sessions: row.sessions,
          euBefore: euBefore.get(pid) ?? 0,
          euAfter: state.eu,
          levelAfter: levelLabel(state.eu, state.marks),
          meanEuFinal,
          ktSessions: ktFinal.ktSessions,
          ktPlayers: ktFinal.ktPlayers,
          ktEu: ktFinal.ktEu,
          ktStatus: ktFinal.ktStatus,
          kt: ktFinal.kt,
          nr,
          vt,
          nrkt,
          nrktvt: nrkt * vt,
        });
      }

      for (const pid of participantIds) knownPlayers.add(pid);
    }

    // Deliberately no calendar-only expiry here. Appendix 3 applies the
    // inactivity check while processing a subsequent tournament.

    const ranking: RankingRow[] = [];
    for (const [pid, state] of states.entries()) {
      if (includeInRanking.get(pid) === false) continue;
      const playerRows = details
        .filter((x) => x.playerId === pid)
        .sort((a, b) => b.nrktvt - a.nrktvt);

      const top = playerRows.slice(0, this.config.topN);
      const t5 = this.config.topN > 0
        ? top.reduce((sum, x) => sum + x.nrktvt, 0) / this.config.topN
        : 0;

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

    ranking.sort(
      (a, b) => b.rating - a.rating || a.playerName.localeCompare(b.playerName, "ru"),
    );
    ranking.forEach((row, i) => {
      row.rank = i + 1;
    });

    return {
      ranking,
      tournamentRows: details,
      diagnostics,
      isComplete: this.config.participantCountPolicy === "strict" ? invalidTournamentKeys.size === 0 : true,
      processedTournamentCount: tournamentMeta.length,
      skippedTournamentCount: invalidTournamentKeys.size,
    };
  }
}
