import { rateFreeForAll } from "./nativeTrueSkill";
import type { MethodDiagnostic, PlayerInput, ResultInput } from "./types";

export interface TrueSkillTournamentConfig {
  muCoef: number;
  sigmaCoef: number;
  betaCoef: number;
  tauCoef: number;
  kCoef: number;
  tournamentCorrectionCoef: number;
  participantsCoef: number;
  sessionsCoef: number;
  minPlayers: number;
}

export interface TrueSkillTournamentRow {
  rank: number;
  playerId: string;
  playerName: string;
  rating: number;
  mu: number;
  sigma: number;
  tournamentsCount: number;
}

export interface TrueSkillTournamentResult {
  ranking: TrueSkillTournamentRow[];
  diagnostics: MethodDiagnostic[];
  isComplete: boolean;
  processedTournamentCount: number;
  skippedTournamentCount: number;
}

export interface SkillHistorySnapshot {
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
  ranking: TrueSkillTournamentRow[];
  processedTournamentCount: number;
}

interface PlayerState {
  mu: number;
  sigma: number;
  tournamentsCount: number;
  lastPlayed: Date | null;
}

const BASE_MU = 25;
const BASE_SIGMA = 25 / 3;
const BASE_BETA = 25 / 6;
const BASE_TAU = 25 / 300;
const BASE_K = 3;
const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;

export function defaultTrueSkillTournamentConfig(): TrueSkillTournamentConfig {
  return {
    muCoef: 1,
    sigmaCoef: 1,
    betaCoef: 1,
    tauCoef: 1,
    kCoef: 1,
    tournamentCorrectionCoef: 1,
    participantsCoef: 1,
    sessionsCoef: 1,
    minPlayers: 4,
  };
}

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function dateValue(v: string): Date { return new Date(`${v}T00:00:00Z`); }
function eventKey(r: ResultInput): string { return `${r.tournament_date}\u0000${Number(r.tournament_order ?? 0)}\u0000${r.tournament_id}`; }

function tournamentWeight(config: TrueSkillTournamentConfig, participants: number, sessions: number): number {
  const n = Math.max(config.minPlayers, participants);
  const h = Math.max(4, sessions || 0);
  const sizeSignal = clamp((n - config.minPlayers) / n, 0, 1);
  const sessionSignal = clamp((h - 4) / h, 0, 1);
  const combined = ((clamp(config.participantsCoef, 0, 3) / 3) * sizeSignal
    + (clamp(config.sessionsCoef, 0, 3) / 3) * sessionSignal) / 2;
  return 1 + (clamp(config.tournamentCorrectionCoef, 0, 3) / 3) * combined;
}

export class TrueSkillTournamentEngine {
  readonly config: TrueSkillTournamentConfig;
  constructor(config: Partial<TrueSkillTournamentConfig> = {}) {
    this.config = { ...defaultTrueSkillTournamentConfig(), ...config };
  }

  private initialState(): PlayerState {
    return {
      mu: BASE_MU * this.config.muCoef,
      sigma: BASE_SIGMA * this.config.sigmaCoef,
      tournamentsCount: 0,
      lastPlayed: null,
    };
  }

  private makeRanking(players: PlayerInput[], states: Map<string, PlayerState>): TrueSkillTournamentRow[] {
    const byId = new Map(players.map((p) => [String(p.player_id), p]));
    const k = BASE_K * this.config.kCoef;
    const rows = [...states.entries()]
      .filter(([id]) => byId.get(id)?.include_in_rating !== false)
      .map(([id, s]) => ({
        rank: 0,
        playerId: id,
        playerName: String(byId.get(id)?.player_name ?? id),
        rating: s.mu - k * s.sigma,
        mu: s.mu,
        sigma: s.sigma,
        tournamentsCount: s.tournamentsCount,
      }))
      .sort((a, b) => b.rating - a.rating || b.mu - a.mu || a.playerName.localeCompare(b.playerName, "ru"));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }

  private run(players: PlayerInput[], results: ResultInput[], evaluationDate?: string, collectHistory = false) {
    const diagnostics: MethodDiagnostic[] = [];
    const states = new Map<string, PlayerState>();
    const byId = new Map(players.map((p) => [String(p.player_id), p]));
    const groups = new Map<string, ResultInput[]>();
    for (const row of results) {
      if (evaluationDate && String(row.tournament_date) > evaluationDate) continue;
      const k = eventKey(row); const bucket = groups.get(k); if (bucket) bucket.push(row); else groups.set(k, [row]);
    }
    const events = [...groups.values()].sort((a, b) => String(a[0].tournament_date).localeCompare(String(b[0].tournament_date)) || Number(a[0].tournament_order ?? 0) - Number(b[0].tournament_order ?? 0) || String(a[0].tournament_id).localeCompare(String(b[0].tournament_id)));
    const snapshots: SkillHistorySnapshot[] = [];
    let processed = 0, skipped = 0;

    const tau = BASE_TAU * clamp(this.config.tauCoef, 0, 3);

    for (const rows of events) {
      const first = rows[0];
      const participantCount = Number(first.participants || rows.length);
      if (rows.length < this.config.minPlayers || participantCount < this.config.minPlayers) {
        skipped += 1;
        diagnostics.push({ level: "warning", code: "TS_MIN_PLAYERS", message: `Турнир ${first.tournament_name}: меньше ${this.config.minPlayers} игроков`, tournamentId: String(first.tournament_id), tournamentName: String(first.tournament_name), tournamentDate: String(first.tournament_date) });
        continue;
      }
      const places = rows.map((r) => Number(r.place));
      if (new Set(places).size !== places.length || places.some((p) => !Number.isFinite(p) || p < 1)) {
        skipped += 1;
        diagnostics.push({ level: "warning", code: "TS_PLACES", message: `Турнир ${first.tournament_name}: места должны быть уникальными положительными числами`, tournamentId: String(first.tournament_id), tournamentName: String(first.tournament_name), tournamentDate: String(first.tournament_date) });
        continue;
      }
      const tournamentDate = dateValue(String(first.tournament_date));
      const priors: PlayerState[] = rows.map((r) => {
        const id = String(r.player_id);
        const old = states.get(id) ?? this.initialState();
        let sigma = old.sigma;
        if (old.lastPlayed && tau > 0) {
          const years = Math.max(0, (tournamentDate.getTime() - old.lastPlayed.getTime()) / YEAR_MS);
          sigma = Math.sqrt(sigma * sigma + tau * tau * years);
        }
        return { ...old, sigma };
      });
      const rated = rateFreeForAll(
        priors.map((s) => ({ mu: s.mu, sigma: s.sigma })),
        rows.map((r) => Number(r.place)),
        BASE_BETA * this.config.betaCoef,
      );
      const weight = tournamentWeight(this.config, participantCount, Number(first.sessions || 0));
      rows.forEach((r, i) => {
        const id = String(r.player_id);
        const prior = priors[i];
        const raw = rated[i];
        const mu = prior.mu + weight * (raw.mu - prior.mu);
        const sigma = Math.max(1e-6, prior.sigma + weight * (raw.sigma - prior.sigma));
        states.set(id, { mu, sigma, tournamentsCount: prior.tournamentsCount + 1, lastPlayed: tournamentDate });
        if (!byId.has(id)) byId.set(id, { player_id: id, player_name: id, include_in_rating: false });
      });
      processed += 1;
      if (collectHistory) {
        snapshots.push({
          index: snapshots.length,
          event: { tournamentId: String(first.tournament_id), tournamentName: String(first.tournament_name), tournamentDate: String(first.tournament_date), tournamentOrder: Number(first.tournament_order ?? 0), participants: participantCount, sessions: Number(first.sessions || 0), isStatusTournament: Boolean(first.is_status_tournament) },
          ranking: this.makeRanking([...byId.values()], states),
          processedTournamentCount: processed,
        });
      }
    }
    return { ranking: this.makeRanking([...byId.values()], states), diagnostics, isComplete: skipped === 0, processedTournamentCount: processed, skippedTournamentCount: skipped, snapshots };
  }

  calculate(players: PlayerInput[], results: ResultInput[], evaluationDate?: string): TrueSkillTournamentResult {
    const r = this.run(players, results, evaluationDate, false);
    return { ranking: r.ranking, diagnostics: r.diagnostics, isComplete: r.isComplete, processedTournamentCount: r.processedTournamentCount, skippedTournamentCount: r.skippedTournamentCount };
  }

  history(players: PlayerInput[], results: ResultInput[]): SkillHistorySnapshot[] { return this.run(players, results, undefined, true).snapshots; }
}
