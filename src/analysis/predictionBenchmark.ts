import type { ResultInput } from "../engine/types";

export interface BenchmarkRankingRow {
  playerId: string;
  rating: number;
}

export interface BenchmarkHistorySnapshot {
  event: {
    tournamentId: string;
    tournamentName: string;
    tournamentDate: string;
    tournamentOrder: number;
  };
  ranking: BenchmarkRankingRow[];
}

export interface BenchmarkMethodInput {
  id: string;
  label: string;
  history: BenchmarkHistorySnapshot[];
}

export interface PredictionEventMetric {
  methodId: string;
  methodLabel: string;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  participants: number;
  ratedParticipants: number;
  totalPairs: number;
  predictedPairs: number;
  correctPairs: number;
  pairwiseAccuracy: number | null;
  pairCoverage: number;
  spearman: number | null;
  latentSpearman: number | null;
}

export interface PredictionMethodSummary {
  methodId: string;
  methodLabel: string;
  eventsScored: number;
  participants: number;
  ratedParticipants: number;
  playerCoverage: number;
  totalPairs: number;
  predictedPairs: number;
  correctPairs: number;
  pairCoverage: number;
  pairwiseAccuracy: number | null;
  meanSpearman: number | null;
  meanLatentSpearman: number | null;
}

export interface PredictionBenchmarkResult {
  methods: PredictionMethodSummary[];
  events: PredictionEventMetric[];
  hasLatentTruth: boolean;
}

function eventKey(event: { tournamentDate: string; tournamentOrder?: number; tournamentId: string }): string {
  return `${event.tournamentDate}\u0000${Number(event.tournamentOrder ?? 0)}\u0000${event.tournamentId}`;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function averageRanks(values: number[], descending = false): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => (descending ? b.value - a.value : a.value - b.value) || a.index - b.index);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i + 1;
    while (j < indexed.length && indexed[j].value === indexed[i].value) j += 1;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) ranks[indexed[k].index] = rank;
    i = j;
  }
  return ranks;
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const meanA = a.reduce((s, x) => s + x, 0) / a.length;
  const meanB = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : null;
}

/** Positive means higher pre-event rating tends to correspond to a better (smaller) place. */
export function ratingVsPlaceSpearman(ratings: number[], places: number[]): number | null {
  if (ratings.length !== places.length || ratings.length < 2) return null;
  const ratingRanks = averageRanks(ratings, true);
  const placeRanks = averageRanks(places, false);
  return pearson(ratingRanks, placeRanks);
}

/** Positive means higher rating tends to correspond to higher latent skill. */
export function ratingVsLatentSpearman(ratings: number[], latent: number[]): number | null {
  if (ratings.length !== latent.length || ratings.length < 2) return null;
  return pearson(averageRanks(ratings, true), averageRanks(latent, true));
}

export function runPredictionBenchmark(
  methods: BenchmarkMethodInput[],
  results: ResultInput[],
  options: { startDate?: string; endDate?: string } = {},
): PredictionBenchmarkResult {
  const grouped = new Map<string, ResultInput[]>();
  for (const row of results) {
    const key = eventKey({
      tournamentDate: String(row.tournament_date),
      tournamentOrder: Number(row.tournament_order ?? 0),
      tournamentId: String(row.tournament_id),
    });
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row); else grouped.set(key, [row]);
  }

  const events = [...grouped.entries()]
    .map(([key, rows]) => ({ key, rows: [...rows].sort((a, b) => Number(a.place) - Number(b.place)) }))
    .sort((a, b) => {
      const ar = a.rows[0]; const br = b.rows[0];
      return String(ar.tournament_date).localeCompare(String(br.tournament_date))
        || Number(ar.tournament_order ?? 0) - Number(br.tournament_order ?? 0)
        || String(ar.tournament_id).localeCompare(String(br.tournament_id));
    });

  const eventMetrics: PredictionEventMetric[] = [];
  let hasLatentTruth = false;

  for (const method of methods) {
    const postByEvent = new Map(method.history.map((snapshot) => [eventKey(snapshot.event), snapshot.ranking]));
    let preRanking: BenchmarkRankingRow[] = [];

    for (const item of events) {
      const first = item.rows[0];
      const date = String(first.tournament_date);
      const inWindow = (!options.startDate || date >= options.startDate) && (!options.endDate || date <= options.endDate);
      if (inWindow) {
        const ratingById = new Map(preRanking.map((row) => [String(row.playerId), Number(row.rating)]));
        const participants = item.rows.length;
        const ratedRows = item.rows.filter((row) => Number.isFinite(ratingById.get(String(row.player_id))));
        const ratedParticipants = ratedRows.length;
        const totalPairs = participants * (participants - 1) / 2;
        let predictedPairs = 0;
        let correctPairs = 0;

        for (let i = 0; i < ratedRows.length; i += 1) {
          for (let j = i + 1; j < ratedRows.length; j += 1) {
            const a = ratedRows[i]; const b = ratedRows[j];
            const ra = ratingById.get(String(a.player_id))!;
            const rb = ratingById.get(String(b.player_id))!;
            if (ra === rb) continue; // a tied rating expresses no pairwise prediction
            predictedPairs += 1;
            const ratingPredictsA = ra > rb;
            const actualA = Number(a.place) < Number(b.place);
            if (ratingPredictsA === actualA) correctPairs += 1;
          }
        }

        const ratings = ratedRows.map((row) => ratingById.get(String(row.player_id))!);
        const places = ratedRows.map((row) => Number(row.place));
        const spearman = ratingVsPlaceSpearman(ratings, places);

        const truthRows = ratedRows
          .map((row) => ({ row, latent: numberOrNull(row.latent_elo_at_event) }))
          .filter((x): x is { row: ResultInput; latent: number } => x.latent !== null);
        if (truthRows.length >= 2) hasLatentTruth = true;
        const latentSpearman = truthRows.length >= 2
          ? ratingVsLatentSpearman(
            truthRows.map((x) => ratingById.get(String(x.row.player_id))!),
            truthRows.map((x) => x.latent),
          )
          : null;

        eventMetrics.push({
          methodId: method.id,
          methodLabel: method.label,
          tournamentId: String(first.tournament_id),
          tournamentName: String(first.tournament_name),
          tournamentDate: date,
          participants,
          ratedParticipants,
          totalPairs,
          predictedPairs,
          correctPairs,
          pairwiseAccuracy: predictedPairs ? correctPairs / predictedPairs : null,
          pairCoverage: totalPairs ? predictedPairs / totalPairs : 0,
          spearman,
          latentSpearman,
        });
      }

      const post = postByEvent.get(item.key);
      if (post) preRanking = post;
    }
  }

  const summaries = methods.map((method) => {
    const rows = eventMetrics.filter((row) => row.methodId === method.id);
    const totalPairs = rows.reduce((s, row) => s + row.totalPairs, 0);
    const predictedPairs = rows.reduce((s, row) => s + row.predictedPairs, 0);
    const correctPairs = rows.reduce((s, row) => s + row.correctPairs, 0);
    const participants = rows.reduce((s, row) => s + row.participants, 0);
    const ratedParticipants = rows.reduce((s, row) => s + row.ratedParticipants, 0);
    return {
      methodId: method.id,
      methodLabel: method.label,
      eventsScored: rows.filter((row) => row.predictedPairs > 0).length,
      participants,
      ratedParticipants,
      playerCoverage: participants ? ratedParticipants / participants : 0,
      totalPairs,
      predictedPairs,
      correctPairs,
      pairCoverage: totalPairs ? predictedPairs / totalPairs : 0,
      pairwiseAccuracy: predictedPairs ? correctPairs / predictedPairs : null,
      meanSpearman: average(rows.flatMap((row) => row.spearman === null ? [] : [row.spearman])),
      meanLatentSpearman: average(rows.flatMap((row) => row.latentSpearman === null ? [] : [row.latentSpearman])),
    } satisfies PredictionMethodSummary;
  });

  return { methods: summaries, events: eventMetrics, hasLatentTruth };
}
