import type { MethodDiagnostic, PlayerInput, ResultInput } from "./types";

export interface RrRangeBand {
  /** Inclusive upper bound in players/sessions; null means infinity. */
  max: number | null;
  /** Increment added for each unit in this band (4 players for player bands, 1 session for session bands). */
  increment: number;
}

export type RrFirstPartMode = "smooth_decay" | "legacy_discrete";

export interface RrConfig {
  ratingWindowDays: number;
  firstPartMode: RrFirstPartMode;
  minimumTournaments: number;
  firstPartBaseTournaments: number;
  firstPartAdditionalShare: number;
  firstPartWeight: number;
  secondPartWeight: number;
  secondPartBestTournaments: number;
  firstPartMissingDenominator: number;
  baseRankScale: number;
  playersPerUnit: number;
  playersCoefficientCap: number;
  sessionsCoefficientCap: number;
  ageFullMonths: number;
  ageZeroMonths: number;
  ageStepMonths: number;
  ageStepDrop: number;
}

export interface RrSpecialCoefficient {
  tournamentId: string;
  playerId: string;
  coefficient: number;
}

export interface RrOverrides {
  playerBands?: RrRangeBand[];
  sessionBands?: RrRangeBand[];
  tournamentTypeMultipliers?: Record<string, number>;
  specialCoefficients?: RrSpecialCoefficient[];
}

export interface RrTournamentContribution {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  playerId: string;
  place: number;
  participants: number;
  sessions: number;
  baseRank: number;
  playersCoefficient: number;
  sessionsCoefficient: number;
  tournamentTypeMultiplier: number;
  specialCoefficientOverride: number | null;
  tournamentCoefficient: number;
  ageWeight: number;
  weightedCoefficient: number;
  delta: number;
  firstPartActive: boolean;
  /** Fractional contribution in P1: 1, 0.8, 0.6, 0.4, 0.2 or 0 under PR #193 defaults. */
  firstPartWeightFactor: number;
  secondPartActive: boolean;
}

export interface RrRankingRow {
  rank: number;
  playerId: string;
  playerName: string;
  rating: number;
  firstPart: number;
  secondPart: number;
  tournamentsCount: number;
  selectedFirstPartCount: number;
  selectedSecondPartCount: number;
}

export interface RrCalculationResult {
  ranking: RrRankingRow[];
  tournamentRows: RrTournamentContribution[];
  maxCoefficient: number;
  diagnostics?: MethodDiagnostic[];
  isComplete?: boolean;
  processedTournamentCount?: number;
  skippedTournamentCount?: number;
}

export const RR_DEFAULT_PLAYER_BANDS: RrRangeBand[] = [
  { max: 60, increment: 0.10 },
  { max: 120, increment: 0.05 },
  { max: 180, increment: 0.01 },
];

export const RR_DEFAULT_SESSION_BANDS: RrRangeBand[] = [
  { max: 8, increment: 0.20 },
  { max: 12, increment: 0.15 },
  { max: 16, increment: 0.10 },
  { max: 20, increment: 0.05 },
];

export const RR_DEFAULT_CONFIG: RrConfig = {
  ratingWindowDays: 365 * 2,
  firstPartMode: "smooth_decay",
  minimumTournaments: 2,
  firstPartBaseTournaments: 5,
  firstPartAdditionalShare: 0.80,
  firstPartWeight: 0.50,
  secondPartWeight: 0.50,
  secondPartBestTournaments: 4,
  firstPartMissingDenominator: 1,
  baseRankScale: 1000,
  playersPerUnit: 4,
  playersCoefficientCap: 2.40,
  sessionsCoefficientCap: 2.80,
  ageFullMonths: 12,
  ageZeroMonths: 24,
  ageStepMonths: 2,
  ageStepDrop: 1 / 7,
};

export const RR_DEFAULT_TYPE_MULTIPLIERS: Record<string, number> = {
  rr: 1,
  ema: 1,
  foreign_ema: 1,
  club: 1,
  region: 1,
  national: 1,
  international: 1,
};


/** Exact defaults from hardcoded_coefficients.py. */
export const RR_DEFAULT_SPECIAL_COEFFICIENTS: RrSpecialCoefficient[] = [
  { tournamentId: "307", playerId: "1821", coefficient: 3.18 },
  { tournamentId: "307", playerId: "154", coefficient: 3.18 },
  { tournamentId: "307", playerId: "252", coefficient: 3.18 },
  { tournamentId: "307", playerId: "118", coefficient: 3.18 },
  { tournamentId: "307", playerId: "176", coefficient: 3.18 },
  { tournamentId: "307", playerId: "79", coefficient: 3.18 },
  { tournamentId: "307", playerId: "69", coefficient: 3.18 },
  { tournamentId: "307", playerId: "119", coefficient: 3.18 },
  { tournamentId: "307", playerId: "81", coefficient: 2.73 },
  { tournamentId: "307", playerId: "162", coefficient: 2.73 },
  { tournamentId: "307", playerId: "78", coefficient: 2.73 },
  { tournamentId: "307", playerId: "256", coefficient: 2.73 },
  { tournamentId: "307", playerId: "52", coefficient: 2.73 },
  { tournamentId: "307", playerId: "254", coefficient: 2.73 },
  { tournamentId: "307", playerId: "159", coefficient: 2.73 },
  { tournamentId: "307", playerId: "158", coefficient: 2.73 },
  { tournamentId: "307", playerId: "134", coefficient: 2.73 },
  { tournamentId: "307", playerId: "156", coefficient: 2.73 },
  { tournamentId: "307", playerId: "151", coefficient: 2.73 },
  { tournamentId: "307", playerId: "83", coefficient: 2.73 },
  { tournamentId: "307", playerId: "190", coefficient: 2.73 },
  { tournamentId: "307", playerId: "70", coefficient: 2.73 },
  { tournamentId: "307", playerId: "182", coefficient: 2.73 },
  { tournamentId: "307", playerId: "1942", coefficient: 2.73 },
  { tournamentId: "383", playerId: "216", coefficient: 3.18 },
  { tournamentId: "383", playerId: "225", coefficient: 3.18 },
  { tournamentId: "383", playerId: "131", coefficient: 3.18 },
  { tournamentId: "383", playerId: "134", coefficient: 3.03 },
  { tournamentId: "383", playerId: "118", coefficient: 3.03 },
  { tournamentId: "383", playerId: "78", coefficient: 3.03 },
  { tournamentId: "383", playerId: "154", coefficient: 3.03 },
  { tournamentId: "383", playerId: "246", coefficient: 3.03 },
  { tournamentId: "383", playerId: "70", coefficient: 3.03 },
  { tournamentId: "383", playerId: "253", coefficient: 3.03 },
  { tournamentId: "383", playerId: "221", coefficient: 3.03 },
  { tournamentId: "383", playerId: "219", coefficient: 3.03 },
  { tournamentId: "383", playerId: "491", coefficient: 3.03 },
];

function parseDate(value: string | Date): Date {
  if (value instanceof Date) return new Date(value);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`RR: некорректная дата ${value}`);
  return d;
}

function monthsBetween(older: Date, newer: Date): number {
  let months =
    (newer.getUTCFullYear() - older.getUTCFullYear()) * 12
    + (newer.getUTCMonth() - older.getUTCMonth());
  if (newer.getUTCDate() < older.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function eventKey(row: ResultInput): string {
  return `${row.tournament_date}\u0000${Number(row.tournament_order ?? 0)}\u0000${row.tournament_id}`;
}

export function defaultRrConfig(): RrConfig {
  return { ...RR_DEFAULT_CONFIG };
}

/**
 * Browser port of RatingRRCalculation from rr.py.
 *
 * Historical staged-tournament overrides from HARDCODED_COEFFICIENTS are
 * reproduced as editable player+tournament coefficient overrides.
 * Tournament-type multipliers remain a separate laboratory-only experiment.
 */
export class RrEngine {
  readonly config: RrConfig;
  readonly playerBands: RrRangeBand[];
  readonly sessionBands: RrRangeBand[];
  readonly tournamentTypeMultipliers: Record<string, number>;
  readonly specialCoefficients: RrSpecialCoefficient[];

  constructor(config: Partial<RrConfig> = {}, overrides: RrOverrides = {}) {
    this.config = { ...RR_DEFAULT_CONFIG, ...config };
    if (Math.abs(this.config.firstPartWeight + this.config.secondPartWeight - 1) > 1e-9) {
      throw new Error("RR: веса первой и второй части должны в сумме давать 1");
    }
    this.playerBands = (overrides.playerBands ?? RR_DEFAULT_PLAYER_BANDS).map((x) => ({ ...x }));
    this.sessionBands = (overrides.sessionBands ?? RR_DEFAULT_SESSION_BANDS).map((x) => ({ ...x }));
    this.tournamentTypeMultipliers = {
      ...RR_DEFAULT_TYPE_MULTIPLIERS,
      ...(overrides.tournamentTypeMultipliers ?? {}),
    };
    this.specialCoefficients = (overrides.specialCoefficients ?? RR_DEFAULT_SPECIAL_COEFFICIENTS)
      .map((x) => ({ ...x, tournamentId: String(x.tournamentId), playerId: String(x.playerId) }));
  }

  baseRank(place: number, participants: number): number {
    if (participants <= 1) throw new Error("RR: participants должен быть > 1");
    if (place < 1 || place > participants) {
      throw new Error(`RR: некорректное место ${place} при N=${participants}`);
    }
    return this.config.baseRankScale * ((participants - place) / (participants - 1));
  }

  private bandCoefficient(value: number, unitSize: number, bands: RrRangeBand[], cap: number): number {
    if (value <= 0 || unitSize <= 0) return 0;
    let remainingUnits = Math.floor(value / unitSize);
    let previousUnits = 0;
    let total = 0;

    for (const band of bands) {
      if (remainingUnits <= 0) break;
      const maxUnits = band.max === null ? Number.POSITIVE_INFINITY : Math.floor(band.max / unitSize);
      const width = Math.max(0, maxUnits - previousUnits);
      const used = Math.min(remainingUnits, width);
      total += used * band.increment;
      remainingUnits -= used;
      previousUnits = maxUnits;
    }

    // rr.py uses a hard cap after the last defined band.
    if (remainingUnits > 0) return cap;
    return Math.min(total, cap);
  }

  playersCoefficient(participants: number): number {
    return this.bandCoefficient(
      participants,
      this.config.playersPerUnit,
      this.playerBands,
      this.config.playersCoefficientCap,
    );
  }

  sessionsCoefficient(sessions: number): number {
    // rr.py caps tournaments beyond the last session band rather than
    // continuing the last incremental slope.
    return this.bandCoefficient(sessions, 1, this.sessionBands, this.config.sessionsCoefficientCap);
  }

  private assumedSessions(row: ResultInput): number {
    const raw = Number(row.sessions);
    if (raw !== 0) return raw;

    // Exact fallback from portal rr.py for tournaments with unknown sessions:
    // 1 day -> 4, 2 days -> 8, 3+ days -> 12.
    // The Python implementation uses (end_date - start_date).days, capped at 3.
    const startRaw = row.tournament_start_date;
    const endRaw = row.tournament_end_date ?? row.tournament_date;
    if (!startRaw || !endRaw) return 0;

    const start = parseDate(startRaw);
    const end = parseDate(endRaw);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;

    let days = Math.floor((end.getTime() - start.getTime()) / 86400000);
    if (days > 3) days = 3;
    if (days < 0) return 0;
    return days * 4;
  }

  tournamentTypeMultiplier(type: unknown): number {
    const key = String(type ?? "").trim().toLowerCase();
    return this.tournamentTypeMultipliers[key] ?? 1;
  }

  specialCoefficient(tournamentId: unknown, playerId: unknown): number | null {
    const tid = String(tournamentId ?? "").trim();
    const pid = String(playerId ?? "").trim();
    const found = this.specialCoefficients.find((x) => x.tournamentId === tid && x.playerId === pid);
    return found?.coefficient ?? null;
  }

  specialTournamentCoefficients(tournamentId: unknown): number[] {
    const tid = String(tournamentId ?? "").trim();
    return [...new Set(this.specialCoefficients.filter((x) => x.tournamentId === tid).map((x) => x.coefficient))];
  }

  tournamentCoefficient(row: ResultInput): {
    playersCoefficient: number;
    sessionsCoefficient: number;
    typeMultiplier: number;
    coefficient: number;
    specialOverride: number | null;
  } {
    const pc = this.playersCoefficient(Number(row.participants));
    const sc = this.sessionsCoefficient(this.assumedSessions(row));
    const tm = this.tournamentTypeMultiplier(row.tournament_type);
    const base = (pc + sc) * tm;
    const specialOverride = this.specialCoefficient(row.tournament_id, row.player_id);
    return { playersCoefficient: pc, sessionsCoefficient: sc, typeMultiplier: tm, coefficient: specialOverride ?? base, specialOverride };
  }

  ageWeight(tournamentDate: Date, ratingDate: Date): number {
    const months = monthsBetween(tournamentDate, ratingDate);
    if (months < this.config.ageFullMonths) return 1;
    if (months >= this.config.ageZeroMonths) return 0;
    const elapsed = months - this.config.ageFullMonths;
    const step = Math.floor(elapsed / this.config.ageStepMonths) + 1;
    return Math.max(0, 1 - step * this.config.ageStepDrop);
  }

  selectedFirstPartTournamentCount(total: number): number {
    // Legacy portal rule: 5 + ceil(80% of tournaments beyond the first five).
    if (total <= this.config.firstPartBaseTournaments) return total;
    return this.config.firstPartBaseTournaments
      + Math.ceil((total - this.config.firstPartBaseTournaments) * this.config.firstPartAdditionalShare);
  }

  private chooseFirstPartLegacy(rows: RrTournamentContribution[], count: number): Array<{ row: RrTournamentContribution; weight: number }> {
    if (rows.length <= count) return rows.map((row) => ({ row, weight: 1 }));

    if (rows.length === count + 1) {
      let bestScore = -1;
      let best: RrTournamentContribution[] = [];
      for (let excluded = 0; excluded < rows.length; excluded += 1) {
        let numerator = 0;
        let denominator = 0;
        const candidate: RrTournamentContribution[] = [];
        rows.forEach((row, i) => {
          if (i === excluded) return;
          numerator += row.delta;
          denominator += row.weightedCoefficient;
          candidate.push(row);
        });
        const score = denominator > 0 ? numerator / denominator : 0;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      return best.map((row) => ({ row, weight: 1 }));
    }

    let left = 0;
    let right = this.config.baseRankScale;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const check = (left + right) / 2;
      const values = rows
        .map((row) => row.delta - check * row.weightedCoefficient)
        .sort((a, b) => b - a)
        .slice(0, count);
      if (values.reduce((sum, value) => sum + value, 0) >= 0) left = check;
      else right = check;
    }
    const bestScore = (left + right) / 2;
    return rows
      .map((row) => ({ row, value: row.delta - bestScore * row.weightedCoefficient }))
      .sort((a, b) => b.value - a.value)
      .slice(0, count)
      .map((x) => ({ row: x.row, weight: 1 }));
  }

  private chooseFirstPartSmooth(rows: RrTournamentContribution[]): Array<{ row: RrTournamentContribution; weight: number }> {
    const total = rows.length;
    const base = this.config.firstPartBaseTournaments;
    if (total <= base) return rows.map((row) => ({ row, weight: 1 }));

    // PR #193: 5 + 80% of additional tournaments is treated as a continuous
    // amount. Under defaults this yields:
    // 6 -> 5 + 0.8, 7 -> 6 + 0.6, 8 -> 7 + 0.4, 9 -> 8 + 0.2, 10 -> 9.
    const effectiveCount = base + (total - base) * this.config.firstPartAdditionalShare;
    const fullCount = Math.floor(effectiveCount + 1e-12);
    const partial = Number((effectiveCount - fullCount).toFixed(12));
    const selectedCount = fullCount + (partial > 1e-12 ? 1 : 0);

    if (selectedCount >= total && partial <= 1e-12) {
      return rows.map((row) => ({ row, weight: 1 }));
    }

    // Fractional-programming search, matching PR #193 semantics:
    // fullCount best impacts have weight 1; the next impact has fractional weight.
    let left = 0;
    let right = this.config.baseRankScale;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const check = (left + right) / 2;
      const impacts = rows
        .map((row) => row.delta - check * row.weightedCoefficient)
        .sort((a, b) => b - a);

      let sum = impacts.slice(0, fullCount).reduce((acc, value) => acc + value, 0);
      if (partial > 1e-12 && impacts.length > fullCount) {
        sum += impacts[fullCount] * partial;
      }

      if (sum >= 0) left = check;
      else right = check;
    }

    const bestScore = (left + right) / 2;
    const ordered = rows
      .map((row) => ({ row, impact: row.delta - bestScore * row.weightedCoefficient }))
      .sort((a, b) => b.impact - a.impact);

    const result: Array<{ row: RrTournamentContribution; weight: number }> = [];
    for (let i = 0; i < Math.min(fullCount, ordered.length); i += 1) {
      result.push({ row: ordered[i].row, weight: 1 });
    }
    if (partial > 1e-12 && ordered.length > fullCount) {
      result.push({ row: ordered[fullCount].row, weight: partial });
    }
    return result;
  }

  private chooseFirstPart(rows: RrTournamentContribution[]): Array<{ row: RrTournamentContribution; weight: number }> {
    if (this.config.firstPartMode === "legacy_discrete") {
      return this.chooseFirstPartLegacy(rows, this.selectedFirstPartTournamentCount(rows.length));
    }
    return this.chooseFirstPartSmooth(rows);
  }

  calculate(
    playersInput: PlayerInput[],
    resultsInput: ResultInput[],
    ratingDateInput: string | Date,
  ): RrCalculationResult {
    const ratingDate = parseDate(ratingDateInput);
    const startDate = addDays(ratingDate, -this.config.ratingWindowDays);

    const players = playersInput.map((p) => ({
      ...p,
      player_id: String(p.player_id),
      include_in_rating: p.include_in_rating !== false,
    }));
    const names = new Map(players.map((p) => [p.player_id, p.player_name]));
    const eligible = new Set(players.filter((p) => p.include_in_rating !== false).map((p) => p.player_id));

    const windowRows = resultsInput
      .map((r) => ({
        ...r,
        player_id: String(r.player_id),
        place: Number(r.place),
        participants: Number(r.participants),
        sessions: Number(r.sessions),
      }))
      .map((r) => ({
        ...r,
        sessions: this.assumedSessions(r),
      }))
      .filter((r) => {
        const d = parseDate(r.tournament_date);
        return d.getTime() > startDate.getTime() && d.getTime() <= ratingDate.getTime();
      });

    const diagnostics: MethodDiagnostic[] = [];
    const invalidTournamentKeys = new Set<string>();
    const seenTournamentKeys = new Set<string>();
    for (const row of windowRows) {
      const key = eventKey(row);
      if (seenTournamentKeys.has(key)) continue;
      seenTournamentKeys.add(key);
      const d = parseDate(row.tournament_date);
      const after2018 = d.getUTCFullYear() >= 2018;
      let reason = "";
      if (row.participants < 16) reason = `N=${row.participants}: для RR требуется минимум 16 игроков`;
      else if (after2018 && row.sessions < 4) reason = `H=${row.sessions}: с 2018 года для RR требуется минимум 4 ханчана`;
      if (reason) {
        invalidTournamentKeys.add(key);
        diagnostics.push({
          level: "warning",
          code: "rr-tournament-ineligible",
          message: reason,
          tournamentId: String(row.tournament_id),
          tournamentName: String(row.tournament_name),
          tournamentDate: String(row.tournament_date),
        });
      }
    }
    const rows = windowRows.filter((row) => !invalidTournamentKeys.has(eventKey(row)));

    // One coefficient record per tournament, like TournamentCoefficients in Django.
    const tournamentRows = new Map<string, ResultInput>();
    for (const row of rows) {
      const key = eventKey(row);
      if (!tournamentRows.has(key)) tournamentRows.set(key, row);
    }

    const tournamentCoefficientValues: number[] = [];
    for (const row of tournamentRows.values()) {
      const d = parseDate(row.tournament_date);
      const age = this.ageWeight(d, ratingDate);
      const staged = this.specialTournamentCoefficients(row.tournament_id);
      if (staged.length > 0) staged.forEach((coefficient) => tournamentCoefficientValues.push(coefficient * age));
      else tournamentCoefficientValues.push(this.tournamentCoefficient(row).coefficient * age);
    }
    tournamentCoefficientValues.sort((a, b) => b - a);
    const selectedGlobal = tournamentCoefficientValues.slice(0, this.config.secondPartBestTournaments);
    while (selectedGlobal.length < this.config.secondPartBestTournaments) {
      selectedGlobal.push(1);
    }
    const maxCoefficient = selectedGlobal.reduce((sum, x) => sum + x, 0);

    const contributions: RrTournamentContribution[] = [];
    for (const row of rows) {
      if (!eligible.has(row.player_id) || Boolean(row.is_substitute)) continue;
      const d = parseDate(row.tournament_date);
      const tc = this.tournamentCoefficient(row);
      const age = this.ageWeight(d, ratingDate);
      const br = this.baseRank(row.place, row.participants);
      const weightedCoefficient = tc.coefficient * age;
      contributions.push({
        tournamentId: row.tournament_id,
        tournamentName: row.tournament_name,
        tournamentDate: row.tournament_date,
        playerId: row.player_id,
        place: row.place,
        participants: row.participants,
        sessions: row.sessions,
        baseRank: br,
        playersCoefficient: tc.playersCoefficient,
        sessionsCoefficient: tc.sessionsCoefficient,
        tournamentTypeMultiplier: tc.typeMultiplier,
        specialCoefficientOverride: tc.specialOverride,
        tournamentCoefficient: tc.coefficient,
        ageWeight: age,
        weightedCoefficient,
        delta: br * weightedCoefficient,
        firstPartActive: false,
        firstPartWeightFactor: 0,
        secondPartActive: false,
      });
    }

    const byPlayer = new Map<string, RrTournamentContribution[]>();
    for (const row of contributions) {
      const arr = byPlayer.get(row.playerId) ?? [];
      arr.push(row);
      byPlayer.set(row.playerId, arr);
    }

    const ranking: RrRankingRow[] = [];
    for (const [playerId, playerRows] of byPlayer.entries()) {
      const total = playerRows.length;
      if (total < this.config.minimumTournaments) continue;

      const firstSelection = this.chooseFirstPart(playerRows);
      firstSelection.forEach(({ row, weight }) => {
        row.firstPartActive = weight > 0;
        row.firstPartWeightFactor = weight;
      });

      let firstNumerator = firstSelection.reduce((sum, x) => sum + x.row.delta * x.weight, 0);
      let firstDenominator = firstSelection.reduce((sum, x) => sum + x.row.weightedCoefficient * x.weight, 0);
      const effectiveSelected = firstSelection.reduce((sum, x) => sum + x.weight, 0);
      const missing = Math.max(0, this.config.firstPartBaseTournaments - effectiveSelected);
      firstDenominator += missing * this.config.firstPartMissingDenominator;
      const firstPart = firstDenominator > 0 ? firstNumerator / firstDenominator : 0;

      const secondRows = [...playerRows]
        .sort((a, b) => b.delta - a.delta)
        .slice(0, this.config.secondPartBestTournaments);
      secondRows.forEach((row) => { row.secondPartActive = true; });
      const secondNumerator = secondRows.reduce((sum, row) => sum + row.delta, 0);
      const secondPart = maxCoefficient > 0 ? secondNumerator / maxCoefficient : 0;

      ranking.push({
        rank: 0,
        playerId,
        playerName: names.get(playerId) ?? playerId,
        rating: firstPart * this.config.firstPartWeight + secondPart * this.config.secondPartWeight,
        firstPart,
        secondPart,
        tournamentsCount: total,
        selectedFirstPartCount: firstSelection.filter((x) => x.weight > 0).length,
        selectedSecondPartCount: secondRows.length,
      });
    }

    ranking.sort((a, b) => b.rating - a.rating || a.playerName.localeCompare(b.playerName, "ru"));
    ranking.forEach((row, index) => { row.rank = index + 1; });

    return {
      ranking,
      tournamentRows: contributions,
      maxCoefficient,
      diagnostics,
      isComplete: true,
      processedTournamentCount: tournamentRows.size,
      skippedTournamentCount: invalidTournamentKeys.size,
    };
  }
}
