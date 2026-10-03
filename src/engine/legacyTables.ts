import type { AgeWeight, Mcr2026Config } from "./types";

export interface LegacyLevel {
  eu: number;
  label: string;
  kind: "kyu" | "dan";
  ordinal: number;
}

export const MCR2026_LEVELS: readonly LegacyLevel[] = Object.freeze([
  { eu: 0, label: "12 кю", kind: "kyu", ordinal: 12 },
  { eu: 50, label: "11 кю", kind: "kyu", ordinal: 11 },
  { eu: 100, label: "10 кю", kind: "kyu", ordinal: 10 },
  { eu: 150, label: "9 кю", kind: "kyu", ordinal: 9 },
  { eu: 200, label: "8 кю", kind: "kyu", ordinal: 8 },
  { eu: 250, label: "7 кю", kind: "kyu", ordinal: 7 },
  { eu: 500, label: "6 кю", kind: "kyu", ordinal: 6 },
  { eu: 750, label: "5 кю", kind: "kyu", ordinal: 5 },
  { eu: 1000, label: "4 кю", kind: "kyu", ordinal: 4 },
  { eu: 1250, label: "3 кю", kind: "kyu", ordinal: 3 },
  { eu: 1500, label: "2 кю", kind: "kyu", ordinal: 2 },
  { eu: 1750, label: "1 кю", kind: "kyu", ordinal: 1 },
  { eu: 2000, label: "1 дан", kind: "dan", ordinal: 1 },
  { eu: 2500, label: "2 дан", kind: "dan", ordinal: 2 },
  { eu: 3000, label: "3 дан", kind: "dan", ordinal: 3 },
  { eu: 3500, label: "4 дан", kind: "dan", ordinal: 4 },
  { eu: 4000, label: "5 дан", kind: "dan", ordinal: 5 },
  { eu: 4500, label: "6 дан", kind: "dan", ordinal: 6 },
  { eu: 5000, label: "7 дан", kind: "dan", ordinal: 7 },
  { eu: 5500, label: "8 дан", kind: "dan", ordinal: 8 },
  { eu: 6000, label: "9 дан", kind: "dan", ordinal: 9 },
  { eu: 6500, label: "10 дан", kind: "dan", ordinal: 10 },
  { eu: 7000, label: "11 дан", kind: "dan", ordinal: 11 },
  { eu: 7500, label: "12 дан", kind: "dan", ordinal: 12 },
]);

export const LEVEL_VALUES = Object.freeze(MCR2026_LEVELS.map((x) => x.eu));
export const EU_TO_LEVEL = new Map(MCR2026_LEVELS.map((x) => [x.eu, x] as const));

export const KT_PARTICIPANTS: Readonly<Record<number, number>> = Object.freeze({
  12: -0.20, 16: -0.10, 20: 0.00, 24: 0.10, 28: 0.20, 32: 0.30,
  36: 0.40, 40: 0.50, 44: 0.55, 48: 0.65, 52: 0.70, 56: 0.75,
  60: 0.80, 64: 0.85, 68: 0.90, 72: 0.90, 76: 0.95, 80: 1.00,
  84: 1.05, 88: 1.05, 92: 1.10, 96: 1.15, 100: 1.15,
  104: 1.20, 108: 1.20, 112: 1.25, 116: 1.25, 120: 1.30,
  124: 1.30, 128: 1.35, 132: 1.35, 136: 1.40, 140: 1.40,
  144: 1.40, 148: 1.45, 152: 1.45, 156: 1.50, 164: 1.50,
});

export const MCR2026_AGE_WEIGHTS: readonly AgeWeight[] = Object.freeze([
  { minMonths: 0, maxMonths: 2, weight: 1.00 },
  { minMonths: 3, maxMonths: 5, weight: 0.92 },
  { minMonths: 6, maxMonths: 8, weight: 0.84 },
  { minMonths: 9, maxMonths: 11, weight: 0.76 },
  { minMonths: 12, maxMonths: 14, weight: 0.68 },
  { minMonths: 15, maxMonths: 17, weight: 0.60 },
  { minMonths: 18, maxMonths: 20, weight: 0.52 },
  { minMonths: 21, maxMonths: 23, weight: 0.44 },
  { minMonths: 24, maxMonths: 26, weight: 0.36 },
  { minMonths: 27, maxMonths: 29, weight: 0.28 },
  { minMonths: 30, maxMonths: 32, weight: 0.20 },
  { minMonths: 33, maxMonths: 35, weight: 0.12 },
  { minMonths: 36, maxMonths: null, weight: 0.00 },
]);

export const MCR2026_DEFAULTS: Readonly<Mcr2026Config> = Object.freeze({
  euWeight: 0.25,
  t5Weight: 0.75,
  topN: 5,
  sessionCoef: 0.10,
  playerCountScale: 1.00,
  euComponentScale: 1.00,
  euNormalizer: 1000.0,
  euRoundStep: 0.05,
  statusTournamentBonus: 1.00,
  decayPerQuarter: 0.08,
  maxAgeMonths: 36,
  doubleStrikeMode: "A",
  substituteEuPolicy: "zero",
  successesPerStep: 2,
  failuresPerStep: 2,
  danStep: 500,
  confirmationMonths: 12,
  protectedEu: 2000,
});
