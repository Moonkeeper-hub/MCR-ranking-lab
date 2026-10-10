export interface PlayerInput {
  player_id: string;
  player_name: string;
  initial_eu?: number;
  initial_marks?: number;
  /**
   * Date of the last tournament before the imported history where
   * EU_before <= NR * KT was satisfied.
   */
  initial_dan_date?: string;
  /** Include player in the displayed/internal rating table. Defaults to true. */
  include_in_rating?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface ResultInput {
  tournament_id: string;
  tournament_name: string;
  tournament_date: string;
  tournament_order?: number;
  player_id: string;
  place: number;
  participants: number;
  sessions: number;
  is_status_tournament: boolean;
  tournament_type?: string;
  tournament_start_date?: string;
  tournament_end_date?: string;
  is_substitute?: boolean;
  /** Deprecated input alias accepted by the CSV parser. */
  is_world_europe?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface EvolutionState {
  eu: number;
  marks: number;
  /** Last tournament date where EU_before <= NR * KT was satisfied. */
  danDate: Date | null;
  /** Number of inactivity periods already applied since danDate. */
  expiryPeriodsApplied: number;
}

export type DoubleStrikeMode = "none" | "A" | "B";
export type DoubleStrikeScope = "every_tournament" | "newcomers_only";
export type SubstituteEuPolicy = "zero" | "average" | "newcomer";
export type EvolutionPolicy = "appendix3" | "novikov_observed";
export type McrParticipantCountPolicy = "strict" | "lower" | "nearest" | "interpolate" | "skip";

export interface Mcr2026Config {
  euWeight: number;
  t5Weight: number;
  topN: number;
  sessionCoef: number;
  playerCountScale: number;
  euComponentScale: number;
  euNormalizer: number;
  euRoundStep: number;
  statusTournamentBonus: number;
  decayPerQuarter: number;
  maxAgeMonths: number;
  doubleStrikeMode: DoubleStrikeMode;
  doubleStrikeScope: DoubleStrikeScope;
  substituteEuPolicy: SubstituteEuPolicy;
  /** Rank-evolution semantics: literal Appendix 3 or reverse-engineered Novikov behaviour. */
  evolutionPolicy: EvolutionPolicy;
  successesPerStep: number;
  failuresPerStep: number;
  danStep: number;
  confirmationMonths: number;
  protectedEu: number;
  /** If true, a player who starts a tournament at kyu may finish it at most at 1 dan (EU 2000). */
  capKyuPromotionAtFirstDan: boolean;
  /** How to handle participant counts missing from the normative KT_ЧУТ table. */
  participantCountPolicy: McrParticipantCountPolicy;
}

export interface AgeWeight {
  minMonths: number;
  maxMonths: number | null;
  weight: number;
}

export interface TableOverrides {
  ktParticipants?: Record<number, number>;
  ageWeights?: AgeWeight[];
}

export interface RankingRow {
  rank: number;
  playerId: string;
  playerName: string;
  rating: number;
  currentEu: number;
  marks: number;
  level: string;
  danDate: Date | null;
  t5: number;
  tournamentsCount: number;
}

export interface TournamentDetail {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  playerId: string;
  place: number;
  participants: number;
  sessions: number;
  euBefore: number;
  euAfter: number;
  levelAfter: string;
  meanEuFinal: number;
  ktSessions: number;
  ktPlayers: number;
  ktEu: number;
  ktStatus: number;
  kt: number;
  nr: number;
  vt: number;
  nrkt: number;
  nrktvt: number;
}

export interface MethodDiagnostic {
  level: "warning" | "error";
  code: string;
  message: string;
  tournamentId?: string;
  tournamentName?: string;
  tournamentDate?: string;
}

export interface CalculationResult {
  ranking: RankingRow[];
  tournamentRows: TournamentDetail[];
  diagnostics?: MethodDiagnostic[];
  isComplete?: boolean;
  processedTournamentCount?: number;
  skippedTournamentCount?: number;
}

export interface CalculationOptions {
  /**
   * If false, players with no initial state only appear after their first
   * tournament in the visible history. If true, every imported player exists
   * at the start of the calculation.
   */
  includeAllPlayers?: boolean;
}

export type InitialStateMode = "clean" | "imported";

export interface TournamentEvent {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  tournamentOrder: number;
  participants: number;
  sessions: number;
  isStatusTournament: boolean;
}

export interface RatingSnapshot {
  index: number;
  event: TournamentEvent;
  result: CalculationResult;
}
