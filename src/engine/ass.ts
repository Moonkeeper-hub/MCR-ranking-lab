import type { MethodDiagnostic, PlayerInput, ResultInput } from "./types";

export interface AssConfig {
  strengthWeight: number;
  achievementWeight: number;
  plStartRating: number;
  plK: number;
  plScale: number;
  initialSigma: number;
  conservativeK: number;
  confidencePlayersCoef: number;
  confidenceSessionsCoef: number;
  displayScale: number;
  achievementAlpha: number;
  achievementHalfLifeMonths: number;
  achievementPrior: number;
  achievementPriorWeight: number;
  fieldStrengthCoef: number;
  fieldStrengthMin: number;
  fieldStrengthMax: number;
  minPlayers: number;
}

export interface AssTournamentContribution {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  playerId: string;
  place: number;
  participants: number;
  sessions: number;
  percentile: number;
  positionScore: number;
  fieldMedianMu: number;
  fieldStrengthScore: number;
  fieldMultiplier: number;
  achievement: number;
}

export interface AssRankingRow {
  rank: number;
  playerId: string;
  playerName: string;
  rating: number;
  strengthScore: number;
  achievementScore: number;
  mu: number;
  sigma: number;
  information: number;
  effectiveAchievementWeight: number;
  tournamentsCount: number;
}

export interface AssResult {
  ranking: AssRankingRow[];
  tournamentRows: AssTournamentContribution[];
  diagnostics: MethodDiagnostic[];
  isComplete: boolean;
  processedTournamentCount: number;
  skippedTournamentCount: number;
}

export interface AssHistorySnapshot {
  index: number;
  event: {
    tournamentId: string;
    tournamentName: string;
    tournamentDate: string;
    tournamentOrder: number;
    participants: number;
    sessions: number;
    isStatusTournament: boolean;
  };
  ranking: AssRankingRow[];
  processedTournamentCount: number;
}

interface AchievementState {
  date: string;
  value: number;
}

interface State {
  mu: number;
  information: number;
  tournamentsCount: number;
  achievements: AchievementState[];
}

export const ASS_DEFAULT_CONFIG: AssConfig = {
  strengthWeight: 0.50,
  achievementWeight: 0.50,
  plStartRating: 1500,
  plK: 32,
  plScale: 400 / Math.log(10),
  initialSigma: 350,
  conservativeK: 1.0,
  confidencePlayersCoef: 0.50,
  confidenceSessionsCoef: 0.50,
  displayScale: 300,
  achievementAlpha: 1.75,
  achievementHalfLifeMonths: 24,
  achievementPrior: 500,
  achievementPriorWeight: 1.0,
  fieldStrengthCoef: 0.25,
  fieldStrengthMin: 0.80,
  fieldStrengthMax: 1.20,
  minPlayers: 4,
};

export function defaultAssConfig(): AssConfig {
  return { ...ASS_DEFAULT_CONFIG };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function eventKey(row: ResultInput): string {
  return `${row.tournament_date}\u0000${Number(row.tournament_order ?? 0)}\u0000${row.tournament_id}`;
}

function monthsBetween(olderIso: string, newerIso: string): number {
  const older = new Date(`${olderIso}T00:00:00Z`);
  const newer = new Date(`${newerIso}T00:00:00Z`);
  if (Number.isNaN(older.getTime()) || Number.isNaN(newer.getTime())) return 0;
  const days = Math.max(0, (newer.getTime() - older.getTime()) / 86_400_000);
  return days / 30.4375;
}

function logisticScore(value: number, center: number, scale: number): number {
  const safeScale = Math.max(1e-6, scale);
  return 1000 / (1 + Math.exp(-(value - center) / safeScale));
}

export class AssEngine {
  readonly config: AssConfig;

  constructor(config: Partial<AssConfig> = {}) {
    this.config = { ...ASS_DEFAULT_CONFIG, ...config };
    if (Math.abs(this.config.strengthWeight + this.config.achievementWeight - 1) > 1e-9) {
      throw new Error("ASS: веса strength и achievement должны в сумме давать 1");
    }
    if (this.config.achievementHalfLifeMonths <= 0) {
      throw new Error("ASS: achievement half-life должен быть > 0");
    }
    if (this.config.fieldStrengthMin <= 0 || this.config.fieldStrengthMax < this.config.fieldStrengthMin) {
      throw new Error("ASS: некорректные границы коэффициента силы поля");
    }
  }

  private confidenceIncrement(participants: number, sessions: number): number {
    const nBase = Math.max(this.config.minPlayers, participants);
    const playerSignal = Math.sqrt(nBase / Math.max(1, this.config.minPlayers));
    const sessionSignal = Math.sqrt(Math.max(1, sessions) / 4);
    return Math.max(
      0.05,
      1
      + this.config.confidencePlayersCoef * (playerSignal - 1)
      + this.config.confidenceSessionsCoef * (sessionSignal - 1),
    );
  }

  private sigma(state: State): number {
    return this.config.initialSigma / Math.sqrt(1 + Math.max(0, state.information));
  }

  private strengthScore(state: State): number {
    const conservative = state.mu - this.config.conservativeK * this.sigma(state);
    return logisticScore(conservative, this.config.plStartRating, this.config.displayScale);
  }

  private achievementScore(state: State, evaluationDate: string): { score: number; effectiveWeight: number } {
    const halfLife = Math.max(1e-6, this.config.achievementHalfLifeMonths);
    let weightedSum = this.config.achievementPriorWeight * this.config.achievementPrior;
    let weightSum = this.config.achievementPriorWeight;
    let effectiveWeight = 0;
    for (const item of state.achievements) {
      const ageMonths = monthsBetween(item.date, evaluationDate);
      const weight = 2 ** (-ageMonths / halfLife);
      weightedSum += weight * item.value;
      weightSum += weight;
      effectiveWeight += weight;
    }
    return {
      score: weightSum > 0 ? weightedSum / weightSum : this.config.achievementPrior,
      effectiveWeight,
    };
  }

  private makeRanking(players: PlayerInput[], states: Map<string, State>, evaluationDate: string): AssRankingRow[] {
    const byId = new Map(players.map((p) => [String(p.player_id), p]));
    const rows = [...states.entries()]
      .filter(([id, state]) => state.tournamentsCount > 0 && byId.get(id)?.include_in_rating !== false)
      .map(([id, state]) => {
        const strengthScore = this.strengthScore(state);
        const achievement = this.achievementScore(state, evaluationDate);
        return {
          rank: 0,
          playerId: id,
          playerName: String(byId.get(id)?.player_name ?? id),
          rating: this.config.strengthWeight * strengthScore + this.config.achievementWeight * achievement.score,
          strengthScore,
          achievementScore: achievement.score,
          mu: state.mu,
          sigma: this.sigma(state),
          information: state.information,
          effectiveAchievementWeight: achievement.effectiveWeight,
          tournamentsCount: state.tournamentsCount,
        };
      });
    rows.sort((a, b) => b.rating - a.rating || b.strengthScore - a.strengthScore || a.playerName.localeCompare(b.playerName, "ru"));
    rows.forEach((row, index) => { row.rank = index + 1; });
    return rows;
  }

  private run(players: PlayerInput[], results: ResultInput[], evaluationDate?: string, collectHistory = false) {
    const diagnostics: MethodDiagnostic[] = [];
    const states = new Map<string, State>();
    const byId = new Map(players.map((p) => [String(p.player_id), p]));
    const grouped = new Map<string, ResultInput[]>();

    for (const row of results) {
      if (evaluationDate && String(row.tournament_date) > evaluationDate) continue;
      const key = eventKey(row);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(row); else grouped.set(key, [row]);
    }

    const events = [...grouped.values()].sort((a, b) =>
      String(a[0].tournament_date).localeCompare(String(b[0].tournament_date))
      || Number(a[0].tournament_order ?? 0) - Number(b[0].tournament_order ?? 0)
      || String(a[0].tournament_id).localeCompare(String(b[0].tournament_id))
    );

    const tournamentRows: AssTournamentContribution[] = [];
    const snapshots: AssHistorySnapshot[] = [];
    let processed = 0;
    let skipped = 0;

    for (const rows0 of events) {
      const rows = [...rows0].sort((a, b) => Number(a.place) - Number(b.place));
      const first = rows[0];
      const participants = Number(first.participants || rows.length);
      const sessions = Number(first.sessions || 0);
      const places = rows.map((row) => Number(row.place));

      if (rows.length < this.config.minPlayers || participants < this.config.minPlayers) {
        skipped++;
        diagnostics.push({
          level: "warning", code: "ASS_MIN_PLAYERS",
          message: `Турнир ${first.tournament_name}: меньше ${this.config.minPlayers} игроков`,
          tournamentId: String(first.tournament_id), tournamentName: String(first.tournament_name), tournamentDate: String(first.tournament_date),
        });
        continue;
      }
      if (new Set(places).size !== places.length || places.some((p) => !Number.isFinite(p) || p < 1 || p > participants)) {
        skipped++;
        diagnostics.push({
          level: "warning", code: "ASS_PLACES",
          message: `Турнир ${first.tournament_name}: места должны быть уникальными и лежать в диапазоне 1…N`,
          tournamentId: String(first.tournament_id), tournamentName: String(first.tournament_name), tournamentDate: String(first.tournament_date),
        });
        continue;
      }

      // Unknown participants are not treated as zero-strength players. Their prior
      // is the median μ of known participants in this tournament; if everybody is
      // unknown, the system-wide start rating is used.
      const knownMus = rows
        .map((row) => states.get(String(row.player_id))?.mu)
        .filter((value): value is number => Number.isFinite(value));
      const inferredUnknownMu = knownMus.length ? median(knownMus) : this.config.plStartRating;
      const prior = rows.map((row) => states.get(String(row.player_id)) ?? {
        mu: inferredUnknownMu,
        information: 0,
        tournamentsCount: 0,
        achievements: [],
      });

      const fieldMedianMu = median(prior.map((state) => state.mu));
      const fieldStrengthScore = logisticScore(fieldMedianMu, this.config.plStartRating, this.config.displayScale);
      const fieldMultiplier = clamp(
        1 + this.config.fieldStrengthCoef * ((fieldStrengthScore - 500) / 500),
        this.config.fieldStrengthMin,
        this.config.fieldStrengthMax,
      );

      const scale = Math.max(1e-6, this.config.plScale);
      const x = prior.map((state) => state.mu / scale);
      const maxX = Math.max(...x);
      const q = x.map((value) => Math.exp(value - maxX));
      const suffix = new Array<number>(q.length);
      let suffixSum = 0;
      for (let i = q.length - 1; i >= 0; i--) {
        suffixSum += q[i];
        suffix[i] = suffixSum;
      }
      const gradients = q.map((qi, j) => {
        let gradient = 1;
        for (let i = 0; i <= j; i++) gradient -= qi / suffix[i];
        return gradient;
      });

      const informationIncrement = this.confidenceIncrement(participants, sessions);
      rows.forEach((row, index) => {
        const id = String(row.player_id);
        const before = prior[index];
        const percentile = participants > 1 ? clamp((participants - Number(row.place)) / (participants - 1), 0, 1) : 0;
        const positionScore = 1000 * (percentile ** this.config.achievementAlpha);
        const achievement = positionScore * fieldMultiplier;
        const next: State = {
          mu: before.mu + this.config.plK * gradients[index],
          information: before.information + informationIncrement,
          tournamentsCount: before.tournamentsCount + 1,
          achievements: [...before.achievements, { date: String(row.tournament_date), value: achievement }],
        };
        states.set(id, next);
        if (!byId.has(id)) byId.set(id, { player_id: id, player_name: id, include_in_rating: true });
        tournamentRows.push({
          tournamentId: String(row.tournament_id), tournamentName: String(row.tournament_name), tournamentDate: String(row.tournament_date),
          playerId: id, place: Number(row.place), participants, sessions, percentile, positionScore,
          fieldMedianMu, fieldStrengthScore, fieldMultiplier, achievement,
        });
      });

      processed++;
      if (collectHistory) {
        const date = String(first.tournament_date);
        snapshots.push({
          index: snapshots.length,
          event: {
            tournamentId: String(first.tournament_id), tournamentName: String(first.tournament_name), tournamentDate: date,
            tournamentOrder: Number(first.tournament_order ?? 0), participants, sessions,
            isStatusTournament: Boolean(first.is_status_tournament),
          },
          ranking: this.makeRanking([...byId.values()], states, date),
          processedTournamentCount: processed,
        });
      }
    }

    const finalEvaluationDate = evaluationDate
      ?? (events.length ? String(events[events.length - 1][0].tournament_date) : new Date().toISOString().slice(0, 10));
    return {
      ranking: this.makeRanking([...byId.values()], states, finalEvaluationDate),
      tournamentRows,
      diagnostics,
      isComplete: skipped === 0,
      processedTournamentCount: processed,
      skippedTournamentCount: skipped,
      snapshots,
    };
  }

  calculate(players: PlayerInput[], results: ResultInput[], evaluationDate?: string): AssResult {
    const result = this.run(players, results, evaluationDate, false);
    return {
      ranking: result.ranking,
      tournamentRows: result.tournamentRows,
      diagnostics: result.diagnostics,
      isComplete: result.isComplete,
      processedTournamentCount: result.processedTournamentCount,
      skippedTournamentCount: result.skippedTournamentCount,
    };
  }

  history(players: PlayerInput[], results: ResultInput[]): AssHistorySnapshot[] {
    return this.run(players, results, undefined, true).snapshots;
  }
}
