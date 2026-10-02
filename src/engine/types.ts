export interface PlayerInput {
  player_id: string;
  player_name: string;
  initial_eu?: number;
  initial_marks?: number;
  initial_dan_date?: string;
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
  is_world_europe: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface EvolutionState {
  eu: number;
  marks: number;
  danDate: Date | null;
}

export interface LegacyConfig {
  euWeight: number;
  t5Weight: number;
  topN: number;
  sessionCoef: number;
  playerCountScale: number;
  euComponentScale: number;
  euNormalizer: number;
  euRoundStep: number;
  worldEuropeBonus: number;
  decayPerQuarter: number;
  maxAgeMonths: number;
  doubleStrike: boolean;
  successesPerStep: number;
  failuresPerStep: number;
  danStep: number;
  confirmationMonths: number;
  protectedEu: number;
  capPlayerCountComponent: boolean;
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
  ktWorld: number;
  kt: number;
  nr: number;
  vt: number;
  nrkt: number;
  nrktvt: number;
}

export interface CalculationResult {
  ranking: RankingRow[];
  tournamentRows: TournamentDetail[];
}
