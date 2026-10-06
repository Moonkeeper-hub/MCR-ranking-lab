
import "./styles.css";
import "katex/dist/katex.min.css";
import { renderMcr2026Math, renderRrMath } from "./ui/formulas";
import { defaultMcr2026Config } from "./engine/legacy";
import {
  defaultRrConfig, RR_DEFAULT_PLAYER_BANDS, RR_DEFAULT_SESSION_BANDS,
  RR_DEFAULT_TYPE_MULTIPLIERS, RR_DEFAULT_SPECIAL_COEFFICIENTS,
} from "./engine/rr";
import type { RrCalculationResult, RrConfig, RrRangeBand, RrSpecialCoefficient } from "./engine/rr";
import {
  KT_PARTICIPANTS,
  MCR2026_AGE_WEIGHTS,
  MCR2026_LEVELS,
  MCR2026_DEFAULTS,
} from "./engine/legacyTables";
import type {
  CalculationResult,
  Mcr2026Config,
  PlayerInput,
  ResultInput,
  TableOverrides,
  InitialStateMode,
  RatingSnapshot,
} from "./engine/types";
import { loadCsvPair, playersFromCsv, resultsFromCsv } from "./data/csv";
import { calculateRankingDistanceMetric, type RankingDistanceMetric } from "./analysis/rankingDistance";
import { LruCache, stableSerialize } from "./performanceCache";
import { RatingWorkerPool } from "./workerPool";

const app = document.querySelector<HTMLDivElement>("#app")!;

let players: PlayerInput[] = [];
let results: ResultInput[] = [];
let currentConfig: Mcr2026Config = defaultMcr2026Config();
let ktExperiment: Record<number, number> = { ...KT_PARTICIPANTS };
let vtExperiment = MCR2026_AGE_WEIGHTS.map((x) => ({ ...x }));
let useKtExperiment = false;
let useVtExperiment = false;
let current: CalculationResult | null = null;
let reference: CalculationResult | null = null;
let rrConfig: RrConfig = defaultRrConfig();
let rrPlayerBands: RrRangeBand[] = RR_DEFAULT_PLAYER_BANDS.map((x) => ({ ...x }));
let rrSessionBands: RrRangeBand[] = RR_DEFAULT_SESSION_BANDS.map((x) => ({ ...x }));
let rrTypeMultipliers: Record<string, number> = { ...RR_DEFAULT_TYPE_MULTIPLIERS };
let rrSpecialCoefficients: RrSpecialCoefficient[] = RR_DEFAULT_SPECIAL_COEFFICIENTS.map((x) => ({ ...x }));
let rrCurrent: RrCalculationResult | null = null;
let rrReference: RrCalculationResult | null = null;
let dataLabel = "встроенный demo dataset";
let evaluationDateState = todayIso();
let activeFormulaToken: string | null = null;
let activeRrFormulaToken: string | null = null;
let activeReferenceTab = 0;
let activeLabMethod: "mcr" | "rr" = "mcr";
let comparisonPresetId = "";

type RankingSortKey =
  | "rank"
  | "playerName"
  | "level"
  | "currentEu"
  | "tournamentsCount"
  | "t5"
  | "rating"
  | "refRating"
  | "deltaRating"
  | "deltaRank";

let rankingSearch = "";
let rankingSortKey: RankingSortKey = "rank";
let rankingSortDir: "asc" | "desc" = "asc";
let expandedPlayerId: string | null = null;

let activeWorkspace: "comparison" | "lab" = "comparison";
let historyInitialMode: InitialStateMode = "clean";

type HistoryMethodId = string;
interface UnifiedHistoryRow {
  rank: number;
  playerId: string;
  playerName: string;
  rating: number;
  tournamentsCount: number;
  level?: string;
  currentEu?: number;
  t5?: number;
}
interface UnifiedHistorySnapshot {
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
  ranking: UnifiedHistoryRow[];
  processedTournamentCount?: number;
}
let historyMethodA: HistoryMethodId = "mcr-default";
let historyMethodB: HistoryMethodId = "rr-default";
let historyPeriodStart = "";
let historyPeriodEnd = "";
let historySettingsOpen: "methods" | "period" | null = null;
let historySnapshots: UnifiedHistorySnapshot[] = [];
let historyReferenceSnapshots: UnifiedHistorySnapshot[] = [];
let historySnapshotIndex = 0;
let historyPlayerId: string | null = null;
let historyExpandedPlayerId: string | null = null;
let historyDirty = true;

let comparisonSortKey = "mcrRank";
let comparisonSortDir: "asc" | "desc" = "asc";
let historyTableSortKey = "rankA";
let historyTableSortDir: "asc" | "desc" = "asc";

let distanceTopN = 100;
let distanceStep = 5;
let datasetRevision = 0;
const mcrCalculationCache = new LruCache<CalculationResult>(24);
const rrCalculationCache = new LruCache<RrCalculationResult>(24);
const historyMethodCache = new LruCache<UnifiedHistorySnapshot[]>(12);
const distanceMetricCache = new LruCache<RankingDistanceMetric>(24);
const ratingWorkers = new RatingWorkerPool();
const mcrInFlight = new Map<string, Promise<CalculationResult>>();
const rrInFlight = new Map<string, Promise<RrCalculationResult>>();
const historyInFlight = new Map<string, Promise<UnifiedHistorySnapshot[]>>();
let recalcTimer: number | undefined;
let recalcGeneration = 0;
let historyGeneration = 0;
const RECALC_DEBOUNCE_MS = 350;
let orderedEventsCacheRevision = -1;
let orderedEventsCache: UnifiedHistorySnapshot["event"][] = [];
let eventRowsCache = new Map<string, ResultInput[]>();

function clearDatasetCaches(): void {
  mcrCalculationCache.clear();
  rrCalculationCache.clear();
  historyMethodCache.clear();
  distanceMetricCache.clear();
  orderedEventsCacheRevision = -1;
  orderedEventsCache = [];
  eventRowsCache = new Map();
  mcrInFlight.clear();
  rrInFlight.clear();
  historyInFlight.clear();
}

function markDatasetChanged(): void {
  datasetRevision += 1;
  clearDatasetCaches();
  historyDirty = true;
  ratingWorkers.setDataset(players, results, datasetRevision);
}

function mcrCalculationKey(config: Mcr2026Config, overrides: TableOverrides, evaluationDate: string): string {
  return `mcr|${datasetRevision}|${evaluationDate}|${stableSerialize(config)}|${stableSerialize(overrides)}`;
}

function rrCalculationKey(config: RrConfig, overrides: { playerBands?: RrRangeBand[]; sessionBands?: RrRangeBand[]; tournamentTypeMultipliers?: Record<string, number>; specialCoefficients?: RrSpecialCoefficient[] }, evaluationDate: string): string {
  return `rr|${datasetRevision}|${evaluationDate}|${stableSerialize(config)}|${stableSerialize(overrides)}`;
}

function getMcrCached(config: Mcr2026Config, overrides: TableOverrides, evaluationDate: string): CalculationResult | undefined {
  return mcrCalculationCache.get(mcrCalculationKey(config, overrides, evaluationDate));
}

function getRrCached(
  config: RrConfig,
  overrides: { playerBands?: RrRangeBand[]; sessionBands?: RrRangeBand[]; tournamentTypeMultipliers?: Record<string, number>; specialCoefficients?: RrSpecialCoefficient[] },
  evaluationDate: string,
): RrCalculationResult | undefined {
  return rrCalculationCache.get(rrCalculationKey(config, overrides, evaluationDate));
}

async function calculateMcrCachedAsync(config: Mcr2026Config, overrides: TableOverrides, evaluationDate: string): Promise<CalculationResult> {
  const key = mcrCalculationKey(config, overrides, evaluationDate);
  const cached = mcrCalculationCache.get(key);
  if (cached) return cached;
  const running = mcrInFlight.get(key);
  if (running) return running;
  const promise = ratingWorkers.run<CalculationResult>({ kind: "mcr", config, overrides, evaluationDate })
    .then((result) => { mcrCalculationCache.set(key, result); return result; })
    .finally(() => mcrInFlight.delete(key));
  mcrInFlight.set(key, promise);
  return promise;
}

async function calculateRrCachedAsync(
  config: RrConfig,
  overrides: { playerBands?: RrRangeBand[]; sessionBands?: RrRangeBand[]; tournamentTypeMultipliers?: Record<string, number>; specialCoefficients?: RrSpecialCoefficient[] },
  evaluationDate: string,
): Promise<RrCalculationResult> {
  const key = rrCalculationKey(config, overrides, evaluationDate);
  const cached = rrCalculationCache.get(key);
  if (cached) return cached;
  const running = rrInFlight.get(key);
  if (running) return running;
  const promise = ratingWorkers.run<RrCalculationResult>({ kind: "rr", config, overrides, evaluationDate })
    .then((result) => { rrCalculationCache.set(key, result); return result; })
    .finally(() => rrInFlight.delete(key));
  rrInFlight.set(key, promise);
  return promise;
}


function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]!));
}
function fmt(v: number, d = 2): string {
  return Number.isFinite(v) ? v.toFixed(d) : "—";
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}


interface SavedLabPreset {
  id: string;
  name: string;
  method: "mcr" | "rr";
  savedAt: string;
  payload: any;
}

const PRESET_STORAGE_KEY = "mcr-rating-lab-presets-v1";

function loadPresets(): SavedLabPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storePresets(items: SavedLabPreset[]): void {
  try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(items)); } catch { /* local-only convenience */ }
}

function captureCurrentPreset(name: string): SavedLabPreset {
  const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (activeLabMethod === "mcr") {
    return { id, name, method: "mcr", savedAt: new Date().toISOString(), payload: {
      config: { ...currentConfig },
      useKtExperiment, useVtExperiment,
      ktExperiment: { ...ktExperiment },
      vtExperiment: vtExperiment.map((x) => ({ ...x })),
    }};
  }
  return { id, name, method: "rr", savedAt: new Date().toISOString(), payload: {
    config: { ...rrConfig },
    playerBands: rrPlayerBands.map((x) => ({ ...x })),
    sessionBands: rrSessionBands.map((x) => ({ ...x })),
    typeMultipliers: { ...rrTypeMultipliers },
    specialCoefficients: rrSpecialCoefficients.map((x) => ({ ...x })),
  }};
}

function applyPreset(preset: SavedLabPreset): void {
  activeLabMethod = preset.method;
  if (preset.method === "mcr") {
    currentConfig = { ...defaultMcr2026Config(), ...(preset.payload?.config ?? {}) };
    useKtExperiment = Boolean(preset.payload?.useKtExperiment);
    useVtExperiment = Boolean(preset.payload?.useVtExperiment);
    ktExperiment = { ...KT_PARTICIPANTS, ...(preset.payload?.ktExperiment ?? {}) };
    vtExperiment = Array.isArray(preset.payload?.vtExperiment)
      ? preset.payload.vtExperiment.map((x: any) => ({ ...x }))
      : MCR2026_AGE_WEIGHTS.map((x) => ({ ...x }));
  } else {
    rrConfig = { ...defaultRrConfig(), ...(preset.payload?.config ?? {}) };
    rrPlayerBands = (preset.payload?.playerBands ?? RR_DEFAULT_PLAYER_BANDS).map((x: RrRangeBand) => ({ ...x }));
    rrSessionBands = (preset.payload?.sessionBands ?? RR_DEFAULT_SESSION_BANDS).map((x: RrRangeBand) => ({ ...x }));
    rrTypeMultipliers = { ...RR_DEFAULT_TYPE_MULTIPLIERS, ...(preset.payload?.typeMultipliers ?? {}) };
    rrSpecialCoefficients = (preset.payload?.specialCoefficients ?? RR_DEFAULT_SPECIAL_COEFFICIENTS).map((x: RrSpecialCoefficient) => ({ ...x }));
  }
}

function scheduleRecalc(delay = RECALC_DEBOUNCE_MS): void {
  // Invalidate an already running calculation as soon as the user changes a
  // control; its eventual result may populate cache, but must not repaint UI.
  recalcGeneration += 1;
  if (recalcTimer !== undefined) window.clearTimeout(recalcTimer);
  setStatus(`Параметры изменены · пересчёт через ${delay} мс…`, true);
  recalcTimer = window.setTimeout(() => {
    recalcTimer = undefined;
    void recalc();
  }, delay);
}

async function recalc(): Promise<void> {
  if (recalcTimer !== undefined) {
    window.clearTimeout(recalcTimer);
    recalcTimer = undefined;
  }
  const generation = ++recalcGeneration;
  const evaluationDate = document.querySelector<HTMLInputElement>("#evaluationDate")?.value || evaluationDateState;
  evaluationDateState = evaluationDate;
  const overrides: TableOverrides = {};
  if (useKtExperiment) overrides.ktParticipants = ktExperiment;
  if (useVtExperiment) overrides.ageWeights = vtExperiment;
  const rrOverrides = {
    playerBands: rrPlayerBands,
    sessionBands: rrSessionBands,
    tournamentTypeMultipliers: rrTypeMultipliers,
    specialCoefficients: rrSpecialCoefficients,
  };
  const rrDefaultOverrides = {
    playerBands: RR_DEFAULT_PLAYER_BANDS,
    sessionBands: RR_DEFAULT_SESSION_BANDS,
    tournamentTypeMultipliers: RR_DEFAULT_TYPE_MULTIPLIERS,
    specialCoefficients: RR_DEFAULT_SPECIAL_COEFFICIENTS,
  };

  const errors: string[] = [];
  setStatus(`Срез ${evaluationDate}: расчёт в двух очередях…`, true);

  const jobs = await Promise.allSettled([
    calculateMcrCachedAsync(currentConfig, overrides, evaluationDate),
    calculateMcrCachedAsync(defaultMcr2026Config(), {}, evaluationDate),
    calculateRrCachedAsync(rrConfig, rrOverrides, evaluationDate),
    calculateRrCachedAsync(defaultRrConfig(), rrDefaultOverrides, evaluationDate),
  ]);
  if (generation !== recalcGeneration) return;

  const assign = <T,>(item: PromiseSettledResult<T>, label: string): T | null => {
    if (item.status === "fulfilled") return item.value;
    errors.push(`${label}: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
    return null;
  };
  current = assign(jobs[0] as PromiseSettledResult<CalculationResult>, "MCR lab");
  reference = assign(jobs[1] as PromiseSettledResult<CalculationResult>, "MCR-2026 default");
  rrCurrent = assign(jobs[2] as PromiseSettledResult<RrCalculationResult>, "RR lab");
  rrReference = assign(jobs[3] as PromiseSettledResult<RrCalculationResult>, "RR default");

  // Selected comparison preset is warmed in the same two-worker queues so the
  // comparison renderer never has to start a cold calculation on the UI thread.
  const selectedPreset = comparisonPresetId ? loadPresets().find((p) => p.id === comparisonPresetId) : undefined;
  if (selectedPreset) {
    try { await warmSavedPreset(selectedPreset, evaluationDate); }
    catch (error) { errors.push(`Preset ${selectedPreset.name}: ${error instanceof Error ? error.message : String(error)}`); }
    if (generation !== recalcGeneration) return;
  }

  syncAllControlValues();
  renderFormulaMath();
  renderOutput();
  renderComparison();
  if (activeWorkspace === "comparison") renderHistoryWorkspace();

  const visibleResults = results.filter((r) => String(r.tournament_date) <= evaluationDate).length;
  const mcrText = reference
    ? `MCR ${reference.isComplete === false ? "⚠ неполный" : "✓"}: ${reference.ranking.length}`
    : "MCR ✕";
  const rrText = rrReference ? `RR ✓: ${rrReference.ranking.length}` : "RR ✕";
  const detail = errors.length ? ` · ${errors.join(" · ")}` : "";
  setStatus(`Срез ${evaluationDate}: ${visibleResults} результатов · ${mcrText} · ${rrText}${detail}`, errors.length === 0);
}

function setStatus(text: string, ok = true): void {
  const el = document.querySelector<HTMLDivElement>("#status");
  if (!el) return;
  el.className = ok ? "micro good" : "micro error";
  el.textContent = text;
}

type NumericKey = {
  [K in keyof Mcr2026Config]: Mcr2026Config[K] extends number ? K : never
}[keyof Mcr2026Config];

interface ControlDef {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
}

const CONTROL_DEFS: Record<string, ControlDef> = {
  euWeight: { key: "euWeight", label: "Вес EU", min: 0, max: 1, step: .01 },
  t5Weight: { key: "t5Weight", label: "Вес T5", min: 0, max: 1, step: .01 },
  topN: { key: "topN", label: "Число лучших турниров", min: 1, max: 10, step: 1, digits: 0 },
  sessionCoef: { key: "sessionCoef", label: "Коэффициент сессии", min: 0, max: .5, step: .01 },
  playerCountScale: { key: "playerCountScale", label: "Масштаб KT участников", min: 0, max: 2, step: .05 },
  euComponentScale: { key: "euComponentScale", label: "Масштаб KT_EU", min: 0, max: 2, step: .05 },
  euNormalizer: { key: "euNormalizer", label: "Нормализатор EU", min: 100, max: 3000, step: 50, digits: 0 },
  euRoundStep: { key: "euRoundStep", label: "Шаг округления KT_EU", min: 0, max: .25, step: .01 },
  statusTournamentBonus: { key: "statusTournamentBonus", label: "Бонус статусного турнира", min: 0, max: 2, step: .05 },
  decayPerQuarter: { key: "decayPerQuarter", label: "Снижение VT / квартал", min: 0, max: .25, step: .01 },
  maxAgeMonths: { key: "maxAgeMonths", label: "Обнуление VT после, мес.", min: 12, max: 72, step: 3, digits: 0 },
  successesPerStep: { key: "successesPerStep", label: "Успехов на повышение", min: 1, max: 5, step: 1, digits: 0 },
  failuresPerStep: { key: "failuresPerStep", label: "Неуспехов на понижение", min: 1, max: 5, step: 1, digits: 0 },
  danStep: { key: "danStep", label: "Шаг дана EU", min: 100, max: 1000, step: 50, digits: 0 },
  confirmationMonths: { key: "confirmationMonths", label: "Срок подтверждения дана, мес.", min: 3, max: 36, step: 3, digits: 0 },
  protectedEu: { key: "protectedEu", label: "Несгораемый EU", min: 0, max: 4000, step: 50, digits: 0 },
};

function controlHtml(name: keyof typeof CONTROL_DEFS, context: string): string {
  const def = CONTROL_DEFS[name];
  const value = Number(currentConfig[def.key]);
  const digits = def.digits ?? 2;
  const id = `${context}-${name}`;
  return `
    <div class="control-row">
      <div class="control-head">
        <label for="${id}">${esc(def.label)}</label>
        <span id="${id}-value" class="control-value">${value.toFixed(digits)}</span>
      </div>
      <input
        id="${id}"
        data-config-key="${String(def.key)}"
        data-pair-context="${context}"
        type="range"
        min="${def.min}"
        max="${def.max}"
        step="${def.step}"
        value="${value}"
      >
    </div>`;
}

function bindNumericControls(root: ParentNode = document): void {
  root.querySelectorAll<HTMLInputElement>("[data-config-key]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.configKey as NumericKey;
      const def = Object.values(CONTROL_DEFS).find((x) => x.key === key)!;
      const value = Number(input.value);
      (currentConfig[key] as number) = value;

      if (key === "euWeight") currentConfig.t5Weight = Number((1 - value).toFixed(2));
      if (key === "t5Weight") currentConfig.euWeight = Number((1 - value).toFixed(2));

      syncAllControlValues();
      scheduleRecalc();
    });
  });
}

function syncAllControlValues(): void {
  document.querySelectorAll<HTMLInputElement>("[data-config-key]").forEach((input) => {
    const key = input.dataset.configKey as NumericKey;
    const def = Object.values(CONTROL_DEFS).find((x) => x.key === key);
    if (!def) return;
    const value = Number(currentConfig[key]);
    input.value = String(value);
    const valueEl = document.getElementById(`${input.id}-value`);
    if (valueEl) valueEl.textContent = value.toFixed(def.digits ?? 2);
  });

  const eu = document.querySelector<HTMLElement>("[data-live='euWeight']");
  const t5 = document.querySelector<HTMLElement>("[data-live='t5Weight']");
  const topN = document.querySelector<HTMLElement>("[data-live='topN']");
  if (eu) eu.textContent = currentConfig.euWeight.toFixed(2);
  if (t5) t5.textContent = currentConfig.t5Weight.toFixed(2);
  if (topN) topN.textContent = String(currentConfig.topN);
}


type RrNumericKey = {
  [K in keyof RrConfig]: RrConfig[K] extends number ? K : never
}[keyof RrConfig];

const RR_CONTROL_DEFS: { key: RrNumericKey; label: string; min: number; max: number; step: number; digits?: number }[] = [
  { key: "firstPartWeight", label: "Вес P1", min: 0, max: 1, step: 0.01 },
  { key: "secondPartWeight", label: "Вес P2", min: 0, max: 1, step: 0.01 },
  { key: "minimumTournaments", label: "Минимум турниров", min: 1, max: 10, step: 1, digits: 0 },
  { key: "firstPartBaseTournaments", label: "База P1", min: 1, max: 10, step: 1, digits: 0 },
  { key: "firstPartAdditionalShare", label: "Доля доп. турниров P1", min: 0, max: 1, step: 0.01 },
  { key: "secondPartBestTournaments", label: "Лучших турниров P2", min: 1, max: 10, step: 1, digits: 0 },
  { key: "firstPartMissingDenominator", label: "Штраф за недостающий турнир P1", min: 0, max: 3, step: 0.05 },
  { key: "baseRankScale", label: "Шкала места", min: 100, max: 2000, step: 50, digits: 0 },
  { key: "ratingWindowDays", label: "Окно рейтинга, дней", min: 90, max: 1460, step: 5, digits: 0 },
  { key: "playersPerUnit", label: "Игроков в единице K_N", min: 1, max: 8, step: 1, digits: 0 },
  { key: "playersCoefficientCap", label: "Cap K_N", min: 0.5, max: 5, step: 0.05 },
  { key: "sessionsCoefficientCap", label: "Cap K_S", min: 0.5, max: 5, step: 0.05 },
  { key: "ageFullMonths", label: "Полный вес, мес.", min: 0, max: 24, step: 1, digits: 0 },
  { key: "ageZeroMonths", label: "Нулевой вес, мес.", min: 6, max: 60, step: 1, digits: 0 },
  { key: "ageStepMonths", label: "Шаг устаревания, мес.", min: 1, max: 12, step: 1, digits: 0 },
  { key: "ageStepDrop", label: "Падение веса за шаг", min: 0, max: 0.5, step: 0.01 },
];

function rrDef(key: RrNumericKey) {
  return RR_CONTROL_DEFS.find((x) => x.key === key)!;
}

function rrControlHtml(def: typeof RR_CONTROL_DEFS[number]): string {
  const value = Number(rrConfig[def.key]);
  const digits = def.digits ?? 2;
  return `<div class="control-row">
    <div class="control-head"><label>${esc(def.label)}</label><span class="control-value">${value.toFixed(digits)}</span></div>
    <input data-rr-config-key="${String(def.key)}" type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${value}">
  </div>`;
}

function renderRrControls(): void {
  const scalars = document.querySelector<HTMLDivElement>("#rrScalarControls");
  if (scalars) scalars.innerHTML = RR_CONTROL_DEFS.map(rrControlHtml).join("");

  const playerBands = document.querySelector<HTMLDivElement>("#rrPlayerBands");
  if (playerBands) playerBands.innerHTML = rrBandTable(rrPlayerBands, "player");
  const sessionBands = document.querySelector<HTMLDivElement>("#rrSessionBands");
  if (sessionBands) sessionBands.innerHTML = rrBandTable(rrSessionBands, "session");
  const specials = document.querySelector<HTMLDivElement>("#rrSpecialCoefficients");
  if (specials) specials.innerHTML = `<div class="micro">Исторические player-specific коэффициенты из HARDCODED_COEFFICIENTS. При совпадении tournament_id + player_id заменяют обычный K турнира.</div>
    <div class="table-wrap compact-table"><table class="editor-table">
      <thead><tr><th>Турнир ID</th><th>Игрок ID</th><th>K</th></tr></thead><tbody>
      ${rrSpecialCoefficients.map((row, i) => `<tr><td><input data-rr-special-tournament="${i}" type="text" value="${esc(row.tournamentId)}"></td><td><input data-rr-special-player="${i}" type="text" value="${esc(row.playerId)}"></td><td><input data-rr-special-coef="${i}" type="number" min="0" max="10" step="0.01" value="${row.coefficient.toFixed(2)}"></td></tr>`).join("")}
      </tbody></table></div>`;
  const types = document.querySelector<HTMLDivElement>("#rrTypeMultipliers");
  if (types) types.innerHTML = `<div class="micro">Лабораторный множитель типа турнира; в историческом rr.py отдельной такой таблицы нет.</div><div class="table-wrap compact-table"><table class="editor-table">
    <thead><tr><th>Тип</th><th>Множитель</th></tr></thead><tbody>
    ${Object.entries(rrTypeMultipliers).map(([type, value]) => `<tr><td>${esc(type)}</td><td><input data-rr-type="${esc(type)}" type="number" min="0" max="5" step="0.05" value="${value.toFixed(2)}"></td></tr>`).join("")}
    </tbody></table></div>`;
  bindRrControls();
}

function rrBandTable(bands: RrRangeBand[], kind: "player" | "session"): string {
  const unit = kind === "player" ? "игроков" : "туров";
  return `<div class="table-wrap compact-table"><table class="editor-table">
    <thead><tr><th>До, ${unit}</th><th>+ за единицу</th></tr></thead><tbody>
    ${bands.map((band, i) => `<tr><td><input data-rr-band-max="${kind}:${i}" type="number" min="1" step="1" value="${band.max ?? ""}"></td><td><input data-rr-band-inc="${kind}:${i}" type="number" min="0" max="2" step="0.01" value="${band.increment.toFixed(2)}"></td></tr>`).join("")}
    </tbody></table></div>`;
}

function bindRrControls(): void {
  document.querySelectorAll<HTMLInputElement>("[data-rr-config-key]").forEach((input) => {
    input.oninput = () => {
      const key = input.dataset.rrConfigKey as RrNumericKey;
      const value = Number(input.value);
      (rrConfig[key] as number) = value;
      if (key === "firstPartWeight") rrConfig.secondPartWeight = Number((1 - value).toFixed(2));
      if (key === "secondPartWeight") rrConfig.firstPartWeight = Number((1 - value).toFixed(2));
      const valueEl = input.closest(".control-row")?.querySelector<HTMLElement>(".control-value");
      if (valueEl) valueEl.textContent = value.toFixed(rrDef(key).digits ?? 2);
      document.querySelectorAll<HTMLInputElement>("[data-rr-config-key]").forEach((other) => {
        const otherKey = other.dataset.rrConfigKey as RrNumericKey;
        if (otherKey === key) return;
        if ((key === "firstPartWeight" && otherKey === "secondPartWeight") || (key === "secondPartWeight" && otherKey === "firstPartWeight")) {
          const otherValue = Number(rrConfig[otherKey]);
          other.value = String(otherValue);
          const otherValueEl = other.closest(".control-row")?.querySelector<HTMLElement>(".control-value");
          if (otherValueEl) otherValueEl.textContent = otherValue.toFixed(rrDef(otherKey).digits ?? 2);
        }
      });
      scheduleRecalc();
    };
  });
  document.querySelectorAll<HTMLInputElement>("[data-rr-band-max]").forEach((input) => {
    input.onchange = () => {
      const [kind, raw] = input.dataset.rrBandMax!.split(":");
      const bands = kind === "player" ? rrPlayerBands : rrSessionBands;
      bands[Number(raw)].max = input.value === "" ? null : Number(input.value);
      recalc();
    };
  });
  document.querySelectorAll<HTMLInputElement>("[data-rr-band-inc]").forEach((input) => {
    input.onchange = () => {
      const [kind, raw] = input.dataset.rrBandInc!.split(":");
      const bands = kind === "player" ? rrPlayerBands : rrSessionBands;
      bands[Number(raw)].increment = Number(input.value);
      recalc();
    };
  });
  document.querySelectorAll<HTMLInputElement>("[data-rr-type]").forEach((input) => {
    input.onchange = () => { rrTypeMultipliers[input.dataset.rrType!] = Number(input.value); recalc(); };
  });
  document.querySelectorAll<HTMLInputElement>("[data-rr-special-tournament]").forEach((input) => {
    input.onchange = () => { rrSpecialCoefficients[Number(input.dataset.rrSpecialTournament!)].tournamentId = input.value.trim(); recalc(); };
  });
  document.querySelectorAll<HTMLInputElement>("[data-rr-special-player]").forEach((input) => {
    input.onchange = () => { rrSpecialCoefficients[Number(input.dataset.rrSpecialPlayer!)].playerId = input.value.trim(); recalc(); };
  });
  document.querySelectorAll<HTMLInputElement>("[data-rr-special-coef]").forEach((input) => {
    input.onchange = () => { rrSpecialCoefficients[Number(input.dataset.rrSpecialCoef!)].coefficient = Number(input.value); recalc(); };
  });
}

async function warmSavedPreset(preset: SavedLabPreset, evaluationDate: string): Promise<void> {
  const payload = preset.payload ?? {};
  if (preset.method === "mcr") {
    const overrides: TableOverrides = {};
    if (payload.useKtExperiment) overrides.ktParticipants = payload.ktExperiment;
    if (payload.useVtExperiment) overrides.ageWeights = payload.vtExperiment;
    await calculateMcrCachedAsync({ ...defaultMcr2026Config(), ...(payload.config ?? {}) }, overrides, evaluationDate);
    return;
  }
  await calculateRrCachedAsync({ ...defaultRrConfig(), ...(payload.config ?? {}) }, {
    playerBands: payload.playerBands ?? RR_DEFAULT_PLAYER_BANDS,
    sessionBands: payload.sessionBands ?? RR_DEFAULT_SESSION_BANDS,
    tournamentTypeMultipliers: payload.typeMultipliers ?? RR_DEFAULT_TYPE_MULTIPLIERS,
    specialCoefficients: payload.specialCoefficients ?? RR_DEFAULT_SPECIAL_COEFFICIENTS,
  }, evaluationDate);
}

function calculateSavedPreset(preset: SavedLabPreset, evaluationDate: string): { name: string; method: string; ranking: Array<{playerId:string; playerName:string; rank:number; rating:number}> } | null {
  const payload = preset.payload ?? {};
  if (preset.method === "mcr") {
    const overrides: TableOverrides = {};
    if (payload.useKtExperiment) overrides.ktParticipants = payload.ktExperiment;
    if (payload.useVtExperiment) overrides.ageWeights = payload.vtExperiment;
    const result = getMcrCached({ ...defaultMcr2026Config(), ...(payload.config ?? {}) }, overrides, evaluationDate);
    return result ? { name: preset.name, method: "MCR", ranking: result.ranking.map((x) => ({ playerId:x.playerId, playerName:x.playerName, rank:x.rank, rating:x.rating })) } : null;
  }
  const result = getRrCached({ ...defaultRrConfig(), ...(payload.config ?? {}) }, {
    playerBands: payload.playerBands ?? RR_DEFAULT_PLAYER_BANDS,
    sessionBands: payload.sessionBands ?? RR_DEFAULT_SESSION_BANDS,
    tournamentTypeMultipliers: payload.typeMultipliers ?? RR_DEFAULT_TYPE_MULTIPLIERS,
    specialCoefficients: payload.specialCoefficients ?? RR_DEFAULT_SPECIAL_COEFFICIENTS,
  }, evaluationDate);
  return result ? { name: preset.name, method: "RR", ranking: result.ranking.map((x) => ({ playerId:x.playerId, playerName:x.playerName, rank:x.rank, rating:x.rating })) } : null;
}

function diagnosticSummaryHtml(title: string, result: { diagnostics?: any[]; isComplete?: boolean; processedTournamentCount?: number; skippedTournamentCount?: number } | null, kind: "mcr" | "rr"): string {
  if (!result) return `<div class="method-validation error"><strong>${esc(title)}</strong><span>Расчёт не выполнен.</span></div>`;
  const diagnostics = result.diagnostics ?? [];
  const groups = new Map<string, number>();
  diagnostics.forEach((d: any) => groups.set(d.message, (groups.get(d.message) ?? 0) + 1));
  const incomplete = result.isComplete === false;
  const cls = incomplete ? "error" : diagnostics.length ? "warn" : "good";
  const state = incomplete ? "⚠ Неполный расчёт" : diagnostics.length ? "⚠ Есть исключённые/адаптированные турниры" : "✓ Данные совместимы";
  const rows = [...groups.entries()].slice(0, 6).map(([message, count]) => `<li>${esc(message)}${count > 1 ? ` × ${count}` : ""}</li>`).join("");
  return `<div class="method-validation ${cls}"><div><strong>${esc(title)}</strong><span>${state}</span></div><div class="micro">Обработано турниров: ${result.processedTournamentCount ?? "—"}${result.skippedTournamentCount ? ` · пропущено: ${result.skippedTournamentCount}` : ""}</div>${rows ? `<ul>${rows}</ul>` : ""}${kind === "mcr" && incomplete ? `<div class="micro">Канонический MCR-2026 не интерполирует отсутствующие ЧУТ. В Лаборатории можно выбрать другой режим обработки и сохранить его как пользовательский preset.</div>` : ""}</div>`;
}

function comparisonSortHeader(label: string, key: string): string {
  const active = comparisonSortKey === key;
  const arrow = active ? (comparisonSortDir === "asc" ? " ↑" : " ↓") : "";
  return `<button class="sort-header" type="button" data-comparison-sort="${esc(key)}">${esc(label)}${arrow}</button>`;
}

function exportComparisonCsv(rows: any[], presetResult: any | null): void {
  const header = ["player_id","player_name","mcr_rank","rr_rank","delta_rr_minus_mcr"];
  if (presetResult) header.push("preset_name","preset_rank","delta_preset_minus_mcr");
  header.push("mcr_rating","rr_rating");
  const lines = [header.map(csvCell).join(",")];
  rows.forEach((x) => {
    const d = x.deltaRank;
    const pd = x.mcrRank !== null && x.presetRank !== null ? x.mcrRank - x.presetRank : null;
    const row: unknown[] = [x.playerId,x.playerName,x.mcrRank ?? "",x.rrRank ?? "",d ?? ""];
    if (presetResult) row.push(presetResult.name,x.presetRank ?? "",pd ?? "");
    row.push(x.mcrRating ?? "",x.rrRating ?? "");
    lines.push(row.map(csvCell).join(","));
  });
  downloadTextFile(`method-comparison-${evaluationDateState}.csv`, lines.join("\r\n"));
}

function renderComparison(): void {
  const host = document.querySelector<HTMLDivElement>("#comparisonRanking");
  const metrics = document.querySelector<HTMLDivElement>("#comparisonMetrics");
  if (!host || !metrics) return;

  const presets = loadPresets();
  const presetSelect = document.querySelector<HTMLSelectElement>("#comparisonPresetSelect");
  if (presetSelect) {
    const existing = comparisonPresetId;
    presetSelect.innerHTML = `<option value="">Без пользовательского пресета</option>` + presets.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === existing ? "selected" : ""}>${esc(p.name)} · ${p.method.toUpperCase()}</option>`
    ).join("");
    presetSelect.onchange = () => { comparisonPresetId = presetSelect.value; void recalc(); };
  }

  const evaluationDate = document.querySelector<HTMLInputElement>("#evaluationDate")?.value || evaluationDateState;
  const selectedPreset = comparisonPresetId ? presets.find((p) => p.id === comparisonPresetId) : undefined;
  const presetResult = selectedPreset ? calculateSavedPreset(selectedPreset, evaluationDate) : null;

  const mcrById = new Map((reference?.ranking ?? []).map((x) => [x.playerId, x]));
  const rrById = new Map((rrReference?.ranking ?? []).map((x) => [x.playerId, x]));
  const presetById = new Map((presetResult?.ranking ?? []).map((x) => [x.playerId, x]));
  const ids = new Set([...mcrById.keys(), ...rrById.keys(), ...presetById.keys()]);
  let rows = [...ids].map((playerId) => {
    const m = mcrById.get(playerId);
    const r = rrById.get(playerId);
    const p = presetById.get(playerId);
    return {
      playerId,
      playerName: m?.playerName ?? r?.playerName ?? p?.playerName ?? playerId,
      mcrRank: m?.rank ?? null,
      rrRank: r?.rank ?? null,
      presetRank: p?.rank ?? null,
      mcrRating: m?.rating ?? null,
      rrRating: r?.rating ?? null,
      presetRating: p?.rating ?? null,
      deltaRank: m && r ? m.rank - r.rank : null,
    };
  });

  const sortValue = (x: any): any => x[comparisonSortKey];
  rows.sort((a,b) => {
    const av=sortValue(a), bv=sortValue(b);
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    let cmp = typeof av === "string" ? String(av).localeCompare(String(bv), "ru") : Number(av)-Number(bv);
    return comparisonSortDir === "asc" ? cmp : -cmp;
  });

  const shared = rows.filter((x) => x.mcrRank !== null && x.rrRank !== null);
  const meanAbs = shared.length ? shared.reduce((sum,x)=>sum+Math.abs(x.deltaRank ?? 0),0)/shared.length : 0;
  metrics.innerHTML = `<div><span>MCR-2026 default</span><strong>${reference?.ranking.length ?? "—"}</strong></div>
    <div><span>RR default</span><strong>${rrReference?.ranking.length ?? "—"}</strong></div>
    <div><span>Средний |Δ места|</span><strong>${shared.length ? fmt(meanAbs,1) : "—"}</strong></div>
    ${presetResult ? `<div><span>${esc(presetResult.name)}</span><strong>${presetResult.ranking.length}</strong></div>` : ""}`;

  const validationHtml = `<div class="method-validation-grid">
    ${diagnosticSummaryHtml("MCR-2026 default", reference, "mcr")}
    ${diagnosticSummaryHtml("RR default", rrReference, "rr")}
  </div>`;

  const presetHeaders = presetResult
    ? `<th>${comparisonSortHeader(`${presetResult.name} #`, "presetRank")}</th><th>Δ preset−MCR</th>` : "";
  host.innerHTML = `${validationHtml}
    <div class="ranking-toolbar"><div class="micro">${rows.length} игроков</div><button id="exportComparisonCsv" class="download-button" type="button">↓ CSV</button></div>
    <div class="table-wrap ranking-wrap"><table class="ranking-table comparison-table">
    <thead><tr><th>${comparisonSortHeader("Игрок", "playerName")}</th><th>${comparisonSortHeader("MCR-2026 #", "mcrRank")}</th><th>${comparisonSortHeader("RR #", "rrRank")}</th><th>${comparisonSortHeader("Δ RR−MCR", "deltaRank")}</th>${presetHeaders}<th>${comparisonSortHeader("MCR Rating", "mcrRating")}</th><th>${comparisonSortHeader("RR", "rrRating")}</th></tr></thead>
    <tbody>${rows.map((x)=>{
      const d=x.deltaRank;
      const pd=x.mcrRank!==null && x.presetRank!==null ? x.mcrRank-x.presetRank : null;
      return `<tr><td>${esc(x.playerName)}</td><td>${x.mcrRank ?? "—"}</td><td>${x.rrRank ?? "—"}</td>
        <td class="${d && d>0?"pos":d&&d<0?"neg":""}">${d===null?"—":`${d>=0?"+":""}${d}`}</td>
        ${presetResult ? `<td>${x.presetRank ?? "—"}</td><td class="${pd && pd>0?"pos":pd&&pd<0?"neg":""}">${pd===null?"—":`${pd>=0?"+":""}${pd}`}</td>` : ""}
        <td>${x.mcrRating===null?"—":fmt(x.mcrRating)}</td><td>${x.rrRating===null?"—":fmt(x.rrRating)}</td></tr>`;
    }).join("")}</tbody></table></div>`;

  host.querySelectorAll<HTMLButtonElement>("[data-comparison-sort]").forEach((button) => {
    button.onclick = () => {
      const key = button.dataset.comparisonSort!;
      if (comparisonSortKey === key) comparisonSortDir = comparisonSortDir === "asc" ? "desc" : "asc";
      else { comparisonSortKey = key; comparisonSortDir = "asc"; }
      renderComparison();
    };
  });
  host.querySelector<HTMLButtonElement>("#exportComparisonCsv")?.addEventListener("click", () => exportComparisonCsv(rows, presetResult));
  renderDistanceMetrics();
}


function distanceHorizonMonths(methodId: string): number {
  const option = historyMethodOptions().find((x) => x.id === methodId);
  if (!option || option.method === "mcr") {
    const config = option?.preset?.payload?.config ?? {};
    return Number(config.maxAgeMonths ?? defaultMcr2026Config().maxAgeMonths);
  }
  const config = option.preset?.payload?.config ?? {};
  return Number(config.ageZeroMonths ?? defaultRrConfig().ageZeroMonths);
}

function distanceMetricForMethod(methodId: string): RankingDistanceMetric {
  const key = [datasetRevision, historyMethodCacheKey(methodId), evaluationDateState, distanceTopN, distanceStep].join("|");
  const cached = distanceMetricCache.get(key);
  if (cached) return cached;
  const cachedHistory = getHistoryCached(methodId);
  if (!cachedHistory) throw new Error("Расчёт истории ещё выполняется");
  const history = cachedHistory.filter((snapshot) => snapshot.event.tournamentDate <= evaluationDateState);
  const metric = calculateRankingDistanceMetric({
    snapshots: history.map((snapshot) => ({
      event: snapshot.event,
      ranking: snapshot.ranking.map((row) => ({ playerId: row.playerId, rank: row.rank })),
      processedTournamentCount: snapshot.processedTournamentCount,
    })),
    results: results.map((row) => ({
      tournamentId: row.tournament_id,
      tournamentDate: String(row.tournament_date),
      tournamentOrder: Number(row.tournament_order ?? 0),
      playerId: row.player_id,
    })),
    horizonMonths: distanceHorizonMonths(methodId),
    topN: distanceTopN,
    step: distanceStep,
  });
  distanceMetricCache.set(key, metric);
  return metric;
}

function xmlEsc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[ch]!));
}

function histogramPlotSvg(metric: RankingDistanceMetric, mode: "mean" | "normalized", title: string, xOffset = 0, maxOverride?: number): string {
  const width = 700;
  const height = 300;
  const padLeft = 52;
  const padRight = 18;
  const padTop = 42;
  const padBottom = 62;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const values = metric.bins.map((bin) => mode === "mean" ? bin.meanTournaments : bin.normalizedByAllTournaments);
  const maxValue = Math.max(1e-9, maxOverride ?? Math.max(...values));
  const slot = plotW / Math.max(1, metric.bins.length);
  const barW = Math.max(1, slot * 0.76);
  const fill = mode === "mean" ? "#5b8ff9" : "#61d9a3";
  const labelEvery = Math.max(1, Math.ceil(metric.bins.length / 10));
  const bars = metric.bins.map((bin, index) => {
    const value = values[index];
    const h = (value / maxValue) * plotH;
    const x = padLeft + index * slot + (slot - barW) / 2;
    const y = padTop + plotH - h;
    const label = index % labelEvery === 0 || index === metric.bins.length - 1
      ? `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 37}" text-anchor="middle" class="axis-label">${xmlEsc(bin.label)}</text>`
      : "";
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="1" fill="${fill}"><title>${xmlEsc(bin.label)} · ${value.toFixed(3)} · n=${bin.observations}</title></rect>${label}`;
  }).join("");
  const grid = [0, .25, .5, .75, 1].map((q) => {
    const y = padTop + plotH - q * plotH;
    const value = maxValue * q;
    return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" class="grid-line"/><text x="${padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="axis-label">${value < 10 ? value.toFixed(2) : value.toFixed(1)}</text>`;
  }).join("");
  return `<g transform="translate(${xOffset},0)"><text x="${padLeft}" y="22" class="plot-title">${xmlEsc(title)}</text>${grid}<line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" class="axis-line"/><line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" class="axis-line"/>${bars}<text x="${padLeft + plotW / 2}" y="${height - 7}" text-anchor="middle" class="axis-title">Место в рейтинге</text></g>`;
}

function distancePairSvg(methodName: string, metric: RankingDistanceMetric): string {
  const width = 1400;
  const height = 340;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
    <style>.bg{fill:#111827}.plot-title{fill:#f8fafc;font:600 15px system-ui,sans-serif}.axis-label{fill:#94a3b8;font:10px system-ui,sans-serif}.axis-title{fill:#cbd5e1;font:11px system-ui,sans-serif}.axis-line{stroke:#64748b;stroke-width:1}.grid-line{stroke:#334155;stroke-width:1}.method-title{fill:#f8fafc;font:700 18px system-ui,sans-serif}</style>
    <rect class="bg" width="100%" height="100%" rx="12"/>
    <text x="18" y="24" class="method-title">${xmlEsc(methodName)} · Top-${metric.topN} · шаг ${metric.step} · окно ${metric.horizonMonths} мес.</text>
    <g transform="translate(0,34)">${histogramPlotSvg(metric, "mean", "Среднее число турниров до места", 0)}${histogramPlotSvg(metric, "normalized", "Σ турниров / все турниры рейтинга", 700)}</g>
  </svg>`;
}

function distanceCsv(methodName: string, metric: RankingDistanceMetric): string {
  const lines = [["method","rank_from","rank_to","observations","tournament_sum","mean_tournaments","normalized_by_all_tournaments","horizon_months","processed_tournaments"].map(csvCell).join(",")];
  metric.bins.forEach((bin) => lines.push([
    methodName, bin.from, bin.to, bin.observations, bin.tournamentSum,
    bin.meanTournaments, bin.normalizedByAllTournaments,
    metric.horizonMonths, metric.totalProcessedTournaments,
  ].map(csvCell).join(",")));
  return lines.join("\r\n");
}

let distanceHistoryRequestKey = "";

function ensureDistanceHistories(methodIds: string[]): void {
  const missing = methodIds.filter((id) => !getHistoryCached(id));
  if (!missing.length) return;
  const key = `${datasetRevision}|${historyInitialMode}|${missing.sort().join(",")}`;
  if (distanceHistoryRequestKey === key) return;
  distanceHistoryRequestKey = key;
  void Promise.allSettled(missing.map((id) => buildHistoryForMethodAsync(id))).then(() => {
    if (distanceHistoryRequestKey !== key) return;
    distanceHistoryRequestKey = "";
    renderDistanceMetrics();
  });
}

function renderDistanceMetrics(): void {
  const host = document.querySelector<HTMLDivElement>("#distanceMetricMethods");
  if (!host) return;
  const methodIds = ["mcr-default", "rr-default"];
  if (comparisonPresetId) methodIds.push(`preset:${comparisonPresetId}`);
  const uniqueIds = [...new Set(methodIds)].filter((id) => historyMethodOptions().some((option) => option.id === id));
  if (!players.length || !results.length) {
    host.innerHTML = `<div class="notice">Загрузите dataset, чтобы рассчитать метрику дистанции.</div>`;
    return;
  }
  ensureDistanceHistories(uniqueIds);

  const calculated = uniqueIds.map((methodId) => {
    const name = historyMethodLabel(methodId);
    try {
      return { methodId, name, metric: distanceMetricForMethod(methodId), error: null as string | null };
    } catch (error) {
      return { methodId, name, metric: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const successful = calculated.filter((x): x is { methodId:string; name:string; metric:RankingDistanceMetric; error:null } => Boolean(x.metric));
  const sharedMeanMax = Math.max(1e-9, ...successful.flatMap((x) => x.metric.bins.map((bin) => bin.meanTournaments)));
  const sharedNormalizedMax = Math.max(1e-9, ...successful.flatMap((x) => x.metric.bins.map((bin) => bin.normalizedByAllTournaments)));

  host.innerHTML = calculated.map(({ methodId, name, metric, error }) => {
    if (!metric) return `<article class="distance-method-card"><h3>${esc(name)}</h3><div class="notice error">${esc(error)}</div></article>`;
    const firstCount = metric.observations.filter((x) => x.kind === "first").length;
    const repeatCount = metric.observations.filter((x) => x.kind === "repeat").length;
    const endCount = metric.observations.filter((x) => x.kind === "end").length;
    const nonEmptyBins = metric.bins.filter((x) => x.observations > 0).length;
    return `<article class="distance-method-card" data-distance-method="${esc(methodId)}">
      <div class="distance-method-head"><div><h3>${esc(name)}</h3><div class="reference-labels"><span>окно ${metric.horizonMonths} мес.</span><span>${metric.players} игроков</span><span>${metric.totalProcessedTournaments} турниров</span><span>${metric.observations.length} наблюдений</span></div></div>
      <div class="distance-actions"><button class="download-button" data-distance-svg="${esc(methodId)}" type="button">↓ SVG</button><button class="download-button" data-distance-csv="${esc(methodId)}" type="button">↓ CSV</button></div></div>
      <div class="distance-observation-summary"><span>первое достижение: <strong>${firstCount}</strong></span><span>повторное: <strong>${repeatCount}</strong></span><span>конец истории: <strong>${endCount}</strong></span><span>непустых диапазонов: <strong>${nonEmptyBins}</strong></span></div>
      <div class="distance-chart-pair">
        <div class="distance-chart"><div class="snapshot-subtitle">Среднее число сыгранных турниров</div><svg viewBox="0 0 700 300" role="img" aria-label="${esc(name)} — средняя дистанция"><style>.plot-title{fill:currentColor;font:600 15px system-ui,sans-serif}.axis-label{fill:#94a3b8;font:10px system-ui,sans-serif}.axis-title{fill:#94a3b8;font:11px system-ui,sans-serif}.axis-line{stroke:#64748b}.grid-line{stroke:#334155}</style>${histogramPlotSvg(metric,"mean","Σ турниров / число наблюдений",0,sharedMeanMax)}</svg></div>
        <div class="distance-chart"><div class="snapshot-subtitle">Нормировка на все турниры рейтинга</div><svg viewBox="0 0 700 300" role="img" aria-label="${esc(name)} — нормированная дистанция"><style>.plot-title{fill:currentColor;font:600 15px system-ui,sans-serif}.axis-label{fill:#94a3b8;font:10px system-ui,sans-serif}.axis-title{fill:#94a3b8;font:11px system-ui,sans-serif}.axis-line{stroke:#64748b}.grid-line{stroke:#334155}</style>${histogramPlotSvg(metric,"normalized","Σ турниров / все турниры рейтинга",0,sharedNormalizedMax)}</svg></div>
      </div>
    </article>`;
  }).join("");

  host.querySelectorAll<HTMLButtonElement>("[data-distance-svg]").forEach((button) => {
    button.onclick = () => {
      const methodId = button.dataset.distanceSvg!;
      const metric = distanceMetricForMethod(methodId);
      const name = historyMethodLabel(methodId);
      downloadTextFile(`distance-${methodId.replace(/[^a-z0-9_-]+/gi,"-")}.svg`, distancePairSvg(name, metric), "image/svg+xml;charset=utf-8");
    };
  });
  host.querySelectorAll<HTMLButtonElement>("[data-distance-csv]").forEach((button) => {
    button.onclick = () => {
      const methodId = button.dataset.distanceCsv!;
      const metric = distanceMetricForMethod(methodId);
      const name = historyMethodLabel(methodId);
      downloadTextFile(`distance-${methodId.replace(/[^a-z0-9_-]+/gi,"-")}.csv`, distanceCsv(name, metric));
    };
  });
}

function renderShell(): void {
  const presets = loadPresets().filter((p) => p.method === activeLabMethod);
  const mcrControls = `
    <details class="side-section" open><summary>Итоговый рейтинг</summary><div class="section-body">
      ${controlHtml("euWeight","side")}${controlHtml("t5Weight","side")}${controlHtml("topN","side")}<div class="sum-note">Σ весов = 1.00</div>
    </div></details>
    <details class="side-section"><summary>Коэффициент турнира</summary><div class="section-body">
      ${controlHtml("sessionCoef","side")}${controlHtml("playerCountScale","side")}${controlHtml("euComponentScale","side")}${controlHtml("euNormalizer","side")}${controlHtml("euRoundStep","side")}${controlHtml("statusTournamentBonus","side")}
      <label class="select-row"><span>ЧУТ вне таблицы KT_ЧУТ</span><select id="participantCountPolicy">
        <option value="strict" ${currentConfig.participantCountPolicy === "strict" ? "selected" : ""}>Strict — неполный расчёт</option>
        <option value="lower" ${currentConfig.participantCountPolicy === "lower" ? "selected" : ""}>Ближайшее нижнее</option>
        <option value="nearest" ${currentConfig.participantCountPolicy === "nearest" ? "selected" : ""}>Ближайшее значение</option>
        <option value="interpolate" ${currentConfig.participantCountPolicy === "interpolate" ? "selected" : ""}>Линейная интерполяция</option>
        <option value="skip" ${currentConfig.participantCountPolicy === "skip" ? "selected" : ""}>Исключить турнир</option>
      </select></label>
    </div></details>
    <details class="side-section"><summary>Устаревание</summary><div class="section-body">${controlHtml("decayPerQuarter","side")}${controlHtml("maxAgeMonths","side")}</div></details>
    <details class="side-section"><summary>EU / даны</summary><div class="section-body compact-stack">
      <label class="select-row"><span>Double Strike</span><select id="doubleStrikeMode">
        <option value="none" ${currentConfig.doubleStrikeMode === "none" ? "selected" : ""}>Нет</option>
        <option value="A" ${currentConfig.doubleStrikeMode === "A" ? "selected" : ""}>A — полный пересчёт</option>
        <option value="B" ${currentConfig.doubleStrikeMode === "B" ? "selected" : ""}>B — продолжение первой итерации</option>
      </select></label>
      <label class="select-row"><span>EU игрока замены</span><select id="substituteEuPolicy">
        <option value="zero" ${currentConfig.substituteEuPolicy === "zero" ? "selected" : ""}>0</option>
        <option value="average" ${currentConfig.substituteEuPolicy === "average" ? "selected" : ""}>Среднее арифметическое</option>
        <option value="newcomer" ${currentConfig.substituteEuPolicy === "newcomer" ? "selected" : ""}>Считать новичком</option>
      </select></label>
      <label class="switch-row"><input type="checkbox" id="capKyuPromotionAtFirstDan" ${currentConfig.capKyuPromotionAtFirstDan ? "checked" : ""}><span>Из кю максимум до 1 дана за один турнир</span></label>
      ${controlHtml("successesPerStep","side")}${controlHtml("failuresPerStep","side")}${controlHtml("danStep","side")}${controlHtml("confirmationMonths","side")}${controlHtml("protectedEu","side")}
    </div></details>`;

  const rrControls = `
    <details class="side-section" open><summary>Итоговая формула и выбор турниров</summary><div class="section-body" id="rrScalarControls"></div></details>
    <details class="side-section" open><summary>Количество игроков K<sub>N</sub></summary><div class="section-body" id="rrPlayerBands"></div></details>
    <details class="side-section"><summary>Количество ханчанов K<sub>H</sub></summary><div class="section-body" id="rrSessionBands"></div></details>
    <details class="side-section"><summary>Турниры с отсечением</summary><div class="section-body" id="rrSpecialCoefficients"></div></details>
    <details class="side-section"><summary>Эксперимент: множитель типа турнира</summary><div class="section-body" id="rrTypeMultipliers"></div></details>`;

  app.innerHTML = `
    <div class="app">
      <header class="topbar"><div><h1>MCR Rating Lab</h1><div class="subtitle">v0.29.2 · TypeScript · MCR-2026 + RR · Comparison · 2 workers + debounce · расчёт выполняется в браузере</div></div>
        <div class="topbar-actions"><div class="privacy-pill">CSV остаются на устройстве пользователя</div>
        <div class="support-wrap"><button id="supportButton" class="support-button" type="button">Donate / Support</button>
        <div id="supportPopover" class="support-popover" hidden><strong>Поддержать проект</strong><span>Перевод по номеру телефона на Сбербанк</span><div class="support-number-row"><code>+7 967 087 1525</code><button id="copySupportNumber" type="button">Копировать</button></div><span id="supportCopyStatus" class="micro"></span></div></div></div>
      </header>

      <nav class="workspace-tabs" aria-label="Режим работы">
        <button id="workspaceComparison" class="workspace-tab ${activeWorkspace === "comparison" ? "active" : ""}" type="button">Сравнение методик + история</button>
        <button id="workspaceLab" class="workspace-tab ${activeWorkspace === "lab" ? "active" : ""}" type="button">Лаборатория</button>
      </nav>

      <section id="comparisonWorkspace" class="workspace-panel ${activeWorkspace === "comparison" ? "active" : ""} comparison-workspace">
        <main class="main comparison-main">
          <section class="results-card">
            <div class="results-head"><div><div class="eyebrow">Сравнение методик</div><h2>MCR-2026 default ↔ RR default</h2>
              <div class="reference-labels"><span>Один dataset</span><span>сравниваем позиции, а не абсолютные шкалы</span></div></div><div id="comparisonMetrics" class="metrics-strip"></div></div>
            <div class="comparison-toolbar"><label>Пользовательский пресет <select id="comparisonPresetSelect"><option value="">Без пользовательского пресета</option></select></label></div>
            <div id="comparisonRanking"></div>
          </section>
          <section class="results-card distance-card">
            <div class="results-head"><div><div class="eyebrow">Метрика дистанции</div><h2>Сколько турниров требуется, чтобы занять и повторно занять место</h2>
              <div class="formula-caption">Для каждого рассчитанного метода строятся две одинаково сгруппированные гистограммы: средняя дистанция в сыгранных турнирах и сумма дистанций, нормированная на общее число турниров метода.</div></div></div>
            <div class="distance-toolbar">
              <label>Top-N <input id="distanceTopN" type="number" min="1" max="500" step="1" value="${distanceTopN}"></label>
              <label>Шаг мест <input id="distanceStep" type="range" min="1" max="10" step="1" value="${distanceStep}"><output id="distanceStepValue">${distanceStep}</output></label>
            </div>
            <details class="distance-explainer"><summary>Как считается метрика</summary><div class="notice">Для каждого игрока берётся первый полный горизонт устаревания конкретной методики и определяется лучшее достигнутое в нём место. Первая обязательная пара — число зачётных турниров игрока за этот начальный горизонт и достигнутое место. Затем считается число его турниров до каждого повторного достижения того же или более высокого места; более высокое место становится новой целью. Последний незавершённый отрезок до конца истории также включается отдельным наблюдением. В графики входят места в пределах выбранного Top-N.</div></details>
            <div id="distanceMetricMethods" class="distance-methods"></div>
          </section>

          <section class="history-card history-embedded">
            <div class="history-header"><div><div class="eyebrow">История / симуляция</div><div class="formula-caption">Шкала истории сохранена ниже сравнения методик.</div></div>
              <label class="history-mode">Начальное состояние<select id="historyInitialMode"><option value="clean" ${historyInitialMode === "clean" ? "selected" : ""}>Чистый старт</option><option value="imported" ${historyInitialMode === "imported" ? "selected" : ""}>Игроки + импортированный EU</option></select></label></div>
            <div id="historySummary" class="history-summary"></div><div class="timeline-control"><input id="historySlider" type="range" min="0" max="0" step="1" value="0"><div id="historyTicks" class="history-ticks"></div></div>
          </section>
          <div id="historySettingsPanel"></div>
          <section class="history-card"><div class="history-player-toolbar"><div><strong>Движение игрока</strong><span class="micro" id="historyChartMethodsLabel">Две выбранные методики</span></div><select id="historyPlayerSelect"></select></div><div id="historyPlayerChart"></div></section>
          <section id="historySnapshotPanel" class="history-card"></section>
        </main>
      </section>

      <div id="labWorkspace" class="workspace-panel ${activeWorkspace === "lab" ? "active" : ""}"><div class="layout">
        <aside class="sidebar"><section class="side-card">
          <div class="side-title">Лаборатория методик</div>
          <div class="section-body compact-stack method-picker">
            <label class="select-row"><span>Методика</span><select id="labMethodSelect"><option value="mcr" ${activeLabMethod === "mcr" ? "selected" : ""}>MCR-2026</option><option value="rr" ${activeLabMethod === "rr" ? "selected" : ""}>RR</option></select></label>
            <div class="preset-box"><label>Сохранённый пресет<select id="labPresetSelect"><option value="">— выбрать —</option>${presets.map((p)=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
            <div class="preset-save-row"><input id="presetName" type="text" placeholder="Название пресета"><button id="savePreset" type="button">Сохранить</button><button id="deletePreset" type="button">Удалить</button></div></div>
          </div>
          <details class="side-section" open><summary>Данные</summary><div class="section-body compact-stack"><div class="notice compact">Источник: <strong id="dataLabel"></strong></div><label class="file-row">players.csv <input id="playersFile" type="file" accept=".csv,text/csv"></label><label class="file-row">results.csv <input id="resultsFile" type="file" accept=".csv,text/csv"></label><div class="button-row"><button id="loadFiles" class="primary">Загрузить</button><button id="loadBuiltin">Demo dataset</button></div><div id="status" class="micro"></div></div></details>
          ${activeLabMethod === "mcr" ? mcrControls : rrControls}
          <div class="sidebar-footer"><label class="date-row">Дата рейтинга<input id="evaluationDate" type="date" value="${evaluationDateState}"></label><button id="resetMethodConfig" class="full">Сбросить ${activeLabMethod === "mcr" ? "MCR-2026" : "RR"} к default</button></div>
        </section></aside>

        <main class="main">
          <section class="formula-card"><div class="eyebrow-row"><div><div class="eyebrow">${activeLabMethod === "mcr" ? "MCR-2026" : "RR"}</div><div class="formula-caption">${activeLabMethod === "mcr" ? "Основная формула и её компоненты" : "Внутренний российский рейтинг: две части A и B"}</div></div><div class="formula-badge">интерактивная формула</div></div>
            <div id="legacyFormulaMount" class="legacy-formula-mount">${activeLabMethod === "mcr" ? renderMcr2026Math(currentConfig) : renderRrMath(rrConfig)}</div>
            <div class="formula-hint">Нажмите на коэффициент или обозначение — ниже появятся пояснение и связанные редактируемые параметры.</div><div id="formulaInspector" class="formula-inspector"></div>
          </section>
          ${activeLabMethod === "mcr" ? `<details class="reference-card"><summary><span>Справочники MCR-2026 — посмотреть и поиграть</span><span class="summary-note">канон + экспериментальные копии</span></summary><div class="reference-body"><div class="tabs" id="tabs"></div><div id="referencePanel"></div></div></details>` : `<details class="reference-card"><summary><span>RR — правила и допуски</span><span class="summary-note">исходная методика</span></summary><div class="reference-body rr-about"><p><strong>Окно:</strong> последние два года. В рейтинге отображаются игроки минимум с двумя неустаревшими турнирами.</p><p><strong>С 2018 года:</strong> в исходной системе учитываются аккредитованные открытые турниры от 16 игроков и от 4 ханчанов; клубные зарубежные турниры не учитываются. Browser-lab предполагает, что загруженный CSV уже отфильтрован по аккредитации/открытости, потому что этих полей в текущей схеме CSV нет.</p><p><strong>Игроки замены:</strong> входят в число участников N при расчёте базового ранга и коэффициента турнира, но сами не отображаются в RR.</p></div></details>`}
          <section class="results-card"><div class="results-head"><div><h2>Рейтинговая таблица</h2><div class="reference-labels"><span>Текущая: <strong>${activeLabMethod === "mcr" ? "MCR-2026 / пользовательская конфигурация" : "RR / пользовательская конфигурация"}</strong></span><span>Эталон: <strong>${activeLabMethod === "mcr" ? "MCR-2026 default" : "RR default"}</strong></span></div></div><div id="metrics" class="metrics-strip"></div></div>
            <div class="ranking-toolbar"><label class="ranking-search"><span>Поиск</span><input id="rankingSearch" type="search" placeholder="Игрок, ID…" value="${esc(rankingSearch)}"></label><div class="ranking-toolbar-actions"><span id="rankingVisibleCount" class="micro"></span><button id="exportRankingCsv" class="download-button" type="button">↓ CSV</button></div></div><div id="deltaLeaders" class="delta-leaders"></div><div id="ranking"></div>
          </section>
        </main>
      </div></div>
    </div>`;

  const dataLabelEl = document.getElementById("dataLabel"); if (dataLabelEl) dataLabelEl.textContent = dataLabel;
  bindNumericControls();
  renderRrControls();
  bindFormulaTokens();
  setupTabs();
  renderFormulaInspector();

  document.getElementById("workspaceComparison")?.addEventListener("click", () => setWorkspace("comparison"));
  document.getElementById("workspaceLab")?.addEventListener("click", () => setWorkspace("lab"));
  document.getElementById("labMethodSelect")?.addEventListener("change", (e) => { activeLabMethod = (e.currentTarget as HTMLSelectElement).value as "mcr"|"rr"; activeFormulaToken=null; activeRrFormulaToken=null; renderShell(); recalc(); });
  document.getElementById("evaluationDate")?.addEventListener("change", (e)=>{ evaluationDateState=(e.currentTarget as HTMLInputElement).value; recalc(); });
  document.getElementById("loadFiles")?.addEventListener("click", loadFiles);
  document.getElementById("loadBuiltin")?.addEventListener("click", loadBuiltin);
  document.getElementById("rankingSearch")?.addEventListener("input", (e) => { rankingSearch=(e.currentTarget as HTMLInputElement).value; renderOutput(); });
  document.getElementById("exportRankingCsv")?.addEventListener("click", () => activeLabMethod === "rr" ? exportRrRankingCsv() : exportRankingCsv());

  document.getElementById("doubleStrikeMode")?.addEventListener("change", (e)=>{ currentConfig.doubleStrikeMode=(e.currentTarget as HTMLSelectElement).value as Mcr2026Config["doubleStrikeMode"]; recalc(); });
  document.getElementById("substituteEuPolicy")?.addEventListener("change", (e)=>{ currentConfig.substituteEuPolicy=(e.currentTarget as HTMLSelectElement).value as Mcr2026Config["substituteEuPolicy"]; recalc(); });
  document.getElementById("capKyuPromotionAtFirstDan")?.addEventListener("change", (e)=>{ currentConfig.capKyuPromotionAtFirstDan=(e.currentTarget as HTMLInputElement).checked; recalc(); });
  document.getElementById("participantCountPolicy")?.addEventListener("change", (e)=>{ currentConfig.participantCountPolicy=(e.currentTarget as HTMLSelectElement).value as Mcr2026Config["participantCountPolicy"]; recalc(); });

  document.getElementById("resetMethodConfig")?.addEventListener("click", ()=>{
    if (activeLabMethod === "mcr") { currentConfig=defaultMcr2026Config(); useKtExperiment=false; useVtExperiment=false; ktExperiment={...KT_PARTICIPANTS}; vtExperiment=MCR2026_AGE_WEIGHTS.map((x)=>({...x})); }
    else { rrConfig=defaultRrConfig(); rrPlayerBands=RR_DEFAULT_PLAYER_BANDS.map((x)=>({...x})); rrSessionBands=RR_DEFAULT_SESSION_BANDS.map((x)=>({...x})); rrTypeMultipliers={...RR_DEFAULT_TYPE_MULTIPLIERS}; rrSpecialCoefficients=RR_DEFAULT_SPECIAL_COEFFICIENTS.map((x)=>({...x})); }
    activeFormulaToken=null; activeRrFormulaToken=null; renderShell(); recalc();
  });

  document.getElementById("savePreset")?.addEventListener("click", ()=>{
    const name=(document.getElementById("presetName") as HTMLInputElement)?.value.trim(); if(!name) return;
    const items=loadPresets(); const p=captureCurrentPreset(name); items.push(p); storePresets(items); comparisonPresetId=p.id; renderShell(); recalc();
  });
  document.getElementById("labPresetSelect")?.addEventListener("change", (e)=>{ const id=(e.currentTarget as HTMLSelectElement).value; const p=loadPresets().find((x)=>x.id===id); if(p){ applyPreset(p); comparisonPresetId=p.id; renderShell(); recalc(); } });
  document.getElementById("deletePreset")?.addEventListener("click", ()=>{ const sel=document.getElementById("labPresetSelect") as HTMLSelectElement; const id=sel?.value; if(!id)return; storePresets(loadPresets().filter((x)=>x.id!==id)); if(comparisonPresetId===id)comparisonPresetId=""; renderShell(); recalc(); });

  const support=document.getElementById("supportButton"); support?.addEventListener("click",()=>{ const pop=document.getElementById("supportPopover") as HTMLDivElement; pop.hidden=!pop.hidden; });
  document.getElementById("copySupportNumber")?.addEventListener("click", async()=>{ const value="+7 967 087 1525"; try{await navigator.clipboard.writeText(value); const x=document.getElementById("supportCopyStatus"); if(x)x.textContent="Номер скопирован";}catch{const x=document.getElementById("supportCopyStatus"); if(x)x.textContent=value;} });

  document.getElementById("distanceTopN")?.addEventListener("change",(e)=>{distanceTopN=Math.max(1,Math.min(500,Math.floor(Number((e.currentTarget as HTMLInputElement).value)||100)));distanceMetricCache.clear();renderDistanceMetrics();});
  document.getElementById("distanceStep")?.addEventListener("input",(e)=>{distanceStep=Math.max(1,Math.min(10,Math.floor(Number((e.currentTarget as HTMLInputElement).value)||1)));const out=document.getElementById("distanceStepValue");if(out)out.textContent=String(distanceStep);distanceMetricCache.clear();renderDistanceMetrics();});
  document.getElementById("historyInitialMode")?.addEventListener("change",(e)=>{historyInitialMode=(e.currentTarget as HTMLSelectElement).value as InitialStateMode;historyDirty=true;historySnapshotIndex=0;distanceMetricCache.clear();renderHistoryWorkspace();renderDistanceMetrics();});
  document.getElementById("historySlider")?.addEventListener("input",(e)=>{historySnapshotIndex=Number((e.currentTarget as HTMLInputElement).value);historyExpandedPlayerId=null;renderHistorySnapshot();});
  document.getElementById("historyPlayerSelect")?.addEventListener("change",(e)=>{historyPlayerId=(e.currentTarget as HTMLSelectElement).value||null;renderHistoryPlayerChart();});
}

function bindFormulaTokens(): void {
  document.querySelectorAll<HTMLElement>("[data-formula-token]").forEach((element) => {
    element.addEventListener("click", () => {
      const token = element.dataset.formulaToken!;
      if (activeLabMethod === "rr") {
        activeRrFormulaToken = activeRrFormulaToken === token ? null : token;
      } else {
        activeFormulaToken = activeFormulaToken === token ? null : token;
      }
      document.querySelectorAll<HTMLElement>("[data-formula-token]").forEach((el)=>el.classList.remove("selected"));
      const active = activeLabMethod === "rr" ? activeRrFormulaToken : activeFormulaToken;
      if (active) document.querySelectorAll<HTMLElement>(`[data-formula-token="${active}"]`).forEach((el)=>el.classList.add("selected"));
      renderFormulaInspector();
    });
  });
}

function renderFormulaMath(): void {
  const mount = document.querySelector<HTMLDivElement>("#legacyFormulaMount");
  if (!mount) return;
  mount.innerHTML = activeLabMethod === "rr" ? renderRrMath(rrConfig) : renderMcr2026Math(currentConfig);
  bindFormulaTokens();
  const active = activeLabMethod === "rr" ? activeRrFormulaToken : activeFormulaToken;
  if (active) mount.querySelectorAll<HTMLElement>(`[data-formula-token="${active}"]`).forEach((el)=>el.classList.add("selected"));
}

const TOKEN_HELP: Record<string, { title: string; text: string; controls?: (keyof typeof CONTROL_DEFS)[]; action?: string }> = {
  wEU: {
    title: "Вес EU",
    text: "Доля текущего EU игрока в итоговом рейтинге. Вес T5 автоматически меняется так, чтобы сумма оставалась 1.",
    controls: ["euWeight"],
  },
  wT5: {
    title: "Вес T5",
    text: "Доля турнирного показателя T5. Вес EU автоматически дополняет его до 1.",
    controls: ["t5Weight"],
  },
  topN: {
    title: "Число лучших турниров",
    text: "Количество лучших взвешенных турнирных результатов, входящих в T5/TN.",
    controls: ["topN"],
  },
  sessionCoef: {
    title: "Коэффициент сессии",
    text: "Вес одной игровой сессии в компоненте KT_ЧС.",
    controls: ["sessionCoef"],
  },
  euNormalizer: {
    title: "Нормализатор EU",
    text: "Делитель среднего EU участников при расчёте компонента KT_EU.",
    controls: ["euNormalizer"],
  },
  euRoundStep: {
    title: "Шаг округления KT_EU",
    text: "Шаг округления вниз компонента среднего EU.",
    controls: ["euRoundStep"],
  },
  euComponentScale: {
    title: "Масштаб KT_EU",
    text: "Экспериментальный множитель компонента среднего EU участников.",
    controls: ["euComponentScale"],
  },
  T5: {
    title: "T5",
    text: "Среднее по N лучшим взвешенным турнирным результатам. Если турниров меньше N, отсутствующие результаты считаются нулевыми.",
    controls: ["topN"],
  },
  NR: {
    title: "NR — норморейтинг",
    text: "Нормированная оценка места игрока: 1000 для первого места и 0 для последнего.",
  },
  N: {
    title: "ЧУТ",
    text: "Число участников турнира. Оно также определяет компонент KT_ЧУТ по справочной таблице.",
    action: "kt",
  },
  place: {
    title: "Место",
    text: "Итоговое место игрока на турнире; входит в NR.",
  },
  KT: {
    title: "KT — коэффициент турнира",
    text: "Сумма компонентов по числу сессий, участникам, среднему EU и статусу турнира.",
    controls: ["sessionCoef", "playerCountScale", "euComponentScale", "statusTournamentBonus"],
  },
  KT_S: {
    title: "KT_ЧС",
    text: "Компонент коэффициента турнира по числу игровых сессий.",
    controls: ["sessionCoef"],
  },
  KT_N: {
    title: "KT_ЧУТ",
    text: "Дискретный компонент KT по ЧУТ. Нормативный расчёт использует только точное значение из таблицы; интерполяции нет.",
    controls: ["playerCountScale"],
    action: "kt",
  },
  KT_EU: {
    title: "KT_EU",
    text: "Компонент по среднему EU участников: нормализация, масштаб и округление вниз с заданным шагом.",
    controls: ["euComponentScale", "euNormalizer", "euRoundStep"],
  },
  KT_W: {
    title: "KT_W",
    text: "Дополнительный бонус турнирам со статусом турнира.",
    controls: ["statusTournamentBonus"],
  },
  VT: {
    title: "VT — вес давности",
    text: "Уменьшает вклад старых турниров. Можно менять общую скорость или редактировать таблицу VT.",
    controls: ["decayPerQuarter", "maxAgeMonths"],
    action: "vt",
  },
  EU: {
    title: "EU и уровни",
    text: "Текущее EU игрока определяет кю/дан и участвует как в итоговом рейтинге, так и в проверке турнирной нормы.",
    controls: ["danStep", "confirmationMonths", "protectedEu"],
  },
  EUbar: {
    title: "Средний EU участников",
    text: "Среднее EU участников турнира, используемое в компоненте KT_EU.",
    controls: ["euComponentScale", "euNormalizer", "euRoundStep"],
  },
  marks: {
    title: "Успехи / неуспехи",
    text: "Результат относительно нормы изменяет накопленные успехи или неуспехи и может перевести игрока на следующую ступень.",
    controls: ["successesPerStep", "failuresPerStep", "danStep"],
  },
  DoubleStrike: {
    title: "Double Strike",
    text: "Применяется, когда в турнире есть новичок (или игрок замены трактуется как новичок). A: первый проход только уточняет EU новичков и KT, затем весь турнир пересчитывается с исходного состояния. B: второй проход продолжает первый и может добавить ещё изменения.",
  },
  X: {
    title: "NRKTVT",
    text: "Взвешенный турнирный вклад игрока: NR × KT × VT. Из этих значений выбираются лучшие для T5.",
  },
};

const RR_TOKEN_HELP: Record<string, { title:string; text:string; controls?:RrNumericKey[]; table?:"players"|"sessions"|"special"|"types" }> = {
  rrW1: { title:"Вес первой части A", text:"Доля первой части в итоговом RR. В исходной методике A и B имеют веса 0.5/0.5; второй вес автоматически дополняет первый до 1.", controls:["firstPartWeight"] },
  rrW2: { title:"Вес второй части B", text:"Доля четырёх лучших турниров в итоговом RR. В исходной методике равна 0.5.", controls:["secondPartWeight"] },
  rrP1: { title:"A — первая часть RR", text:"Взвешенное среднее турнирных результатов. Если сыграно меньше пяти турниров, недостающие позиции добавляют 0 в числитель и единицу в знаменатель. При более чем пяти турнирах берутся 5 + 80% оставшихся лучших результатов.", controls:["firstPartBaseTournaments","firstPartAdditionalShare","firstPartMissingDenominator"] },
  rrP2: { title:"B — вторая часть RR", text:"Сумма лучших турнирных вкладов игрока делится на сумму максимальных доступных коэффициентов турниров за окно рейтинга. В исходной методике используются четыре лучших турнира.", controls:["secondPartBestTournaments"] },
  rrBR: { title:"R — базовый ранг", text:"Турнирный результат игрока от 0 до 1000: первое место даёт максимум, последнее — 0. В N входят и игроки замены.", controls:["baseRankScale"] },
  rrScale: { title:"Шкала базового ранга", text:"В исходном RR верхняя граница базового ранга равна 1000. Изменение масштабирует вклад места во всех турнирах.", controls:["baseRankScale"] },
  rrN: { title:"N — количество игроков", text:"Общее число участников турнира, включая игроков замены. Используется одновременно в базовом ранге R и коэффициенте K_N.", controls:["playersPerUnit","playersCoefficientCap"], table:"players" },
  rrPlace: { title:"p — место игрока", text:"Итоговое место в турнире. R = 1000·(N−p)/(N−1)." },
  rrDelta: { title:"Турнирный вклад D", text:"Произведение базового ранга R, веса турнира W и коэффициента устаревания A. Именно эти значения участвуют в выборе лучших результатов." },
  rrW: { title:"W — коэффициент турнира", text:"Для обычного турнира W = K_N + K_H. Для турниров с отсечением историческая реализация может задавать player-specific W в зависимости от достигнутого этапа.", table:"special" },
  rrKN: { title:"K_N — вклад количества игроков", text:"За первые 60 игроков добавляется 0.10 за каждую четвёрку, с 61 по 120 — 0.05, с 121 по 180 — 0.01; после 180 коэффициент фиксируется. Диапазоны и ставки можно редактировать.", controls:["playersPerUnit","playersCoefficientCap"], table:"players" },
  rrKS: { title:"K_H — вклад количества ханчанов", text:"Первые 8 ханчанов дают по 0.20, 9–12 — по 0.15, 13–16 — по 0.10, 17–20 — по 0.05; после 20 коэффициент фиксируется на 2.8. Диапазоны редактируются.", controls:["sessionsCoefficientCap"], table:"sessions" },
  rrCut: { title:"W для турнира с отсечением", text:"Для турниров с несколькими этапами W может зависеть от игрока: K_N плюс среднее между коэффициентом ханчанов, сыгранных этим игроком, и средневзвешенным K_H турнира. В текущей CSV-схеме нет этапов, поэтому исторические значения из hardcoded_coefficients используются как player-specific W.", table:"special" },
  rrAge: { title:"A — угасание результата", text:"Турниры младше 12 месяцев учитываются полностью. Затем вес уменьшается на 1/7 каждые два месяца и становится нулевым после двух лет.", controls:["ratingWindowDays","ageFullMonths","ageZeroMonths","ageStepMonths","ageStepDrop"] },
  rrM: { title:"m(T) — сколько турниров входит в A", text:"До базового порога учитываются все турниры. Далее добавляется заданная доля дополнительных турниров с округлением вверх.", controls:["firstPartBaseTournaments","firstPartAdditionalShare"] },
  rrBaseCount: { title:"Базовое число турниров", text:"Исходный RR использует 5 турниров как базу первой части.", controls:["firstPartBaseTournaments"] },
  rrShare: { title:"Доля дополнительных турниров", text:"Из турниров сверх базовых в первую часть попадает 80% лучших, с округлением вверх.", controls:["firstPartAdditionalShare"] },
  rrWeightedK: { title:"W·A в знаменателе A", text:"Первая часть нормируется на сумму весов выбранных турниров с учётом устаревания." },
  rrFill: { title:"Заполнитель недостающего турнира", text:"Если сыграно меньше базовых пяти турниров, каждый недостающий турнир даёт 0 в числитель и это значение в знаменатель. В исходной формуле F=1.", controls:["firstPartMissingDenominator"] },
  rrBestCount: { title:"Число лучших турниров B", text:"Количество лучших по R·W·A турниров во второй части. Исходное значение — 4.", controls:["secondPartBestTournaments"] },
  rrMaxCoef: { title:"MAXK — эталонные максимальные коэффициенты", text:"Для всех игроков знаменатель B одинаков: сумма нескольких максимальных W·A среди турниров в двухлетнем окне. Для турниров с отсечением учитываются их специальные коэффициенты.", controls:["secondPartBestTournaments"], table:"special" },
};

function rrInspectorTable(kind: "players"|"sessions"|"special"|"types"): string {
  if (kind === "players") return `<div class="inspector-table"><strong>Диапазоны K_N</strong>${rrBandTable(rrPlayerBands,"player")}</div>`;
  if (kind === "sessions") return `<div class="inspector-table"><strong>Диапазоны K_H</strong>${rrBandTable(rrSessionBands,"session")}</div>`;
  if (kind === "special") return `<div class="inspector-table"><strong>Турниры с отсечением / исторические W</strong><div class="table-wrap compact-table"><table class="editor-table"><thead><tr><th>Турнир ID</th><th>Игрок ID</th><th>W</th></tr></thead><tbody>${rrSpecialCoefficients.map((row,i)=>`<tr><td><input data-rr-special-tournament="${i}" value="${esc(row.tournamentId)}"></td><td><input data-rr-special-player="${i}" value="${esc(row.playerId)}"></td><td><input data-rr-special-coef="${i}" type="number" step="0.01" value="${row.coefficient.toFixed(2)}"></td></tr>`).join("")}</tbody></table></div></div>`;
  return `<div class="inspector-table"><strong>Экспериментальный множитель типа турнира</strong><div class="table-wrap compact-table"><table class="editor-table"><tbody>${Object.entries(rrTypeMultipliers).map(([k,v])=>`<tr><td>${esc(k)}</td><td><input data-rr-type="${esc(k)}" type="number" step="0.05" value="${v.toFixed(2)}"></td></tr>`).join("")}</tbody></table></div></div>`;
}

function renderFormulaInspector(): void {
  const panel = document.querySelector<HTMLDivElement>("#formulaInspector");
  if (!panel) return;

  if (activeLabMethod === "rr") {
    if (!activeRrFormulaToken) { panel.innerHTML=""; panel.classList.remove("open"); return; }
    const item = RR_TOKEN_HELP[activeRrFormulaToken];
    if (!item) { panel.innerHTML=""; panel.classList.remove("open"); return; }
    const controls = (item.controls ?? []).map((key)=>rrControlHtml(rrDef(key))).join("");
    panel.innerHTML = `<div class="inspector-copy"><strong>${esc(item.title)}</strong><span>${esc(item.text)}</span></div>${controls?`<div class="inspector-controls">${controls}</div>`:""}${item.table?rrInspectorTable(item.table):""}`;
    panel.classList.add("open");
    bindRrControls();
    return;
  }

  if (!activeFormulaToken) {
    panel.innerHTML = "";
    panel.classList.remove("open");
    return;
  }

  const item = TOKEN_HELP[activeFormulaToken];
  if (!item) {
    panel.innerHTML = "";
    panel.classList.remove("open");
    return;
  }

  let controls = (item.controls ?? []).map((name) => controlHtml(name, "formula")).join("");

  if (activeFormulaToken === "DoubleStrike") {
    controls += `
      <label class="select-row inspector-switch">
        <span>Double Strike</span>
        <select id="formulaDoubleStrike">
          <option value="none" ${currentConfig.doubleStrikeMode === "none" ? "selected" : ""}>Нет</option>
          <option value="A" ${currentConfig.doubleStrikeMode === "A" ? "selected" : ""}>A — полный пересчёт</option>
          <option value="B" ${currentConfig.doubleStrikeMode === "B" ? "selected" : ""}>B — продолжение первой итерации</option>
        </select>
      </label>`;
  }

  const action = item.action
    ? `<button class="small-action" id="openReferenceAction">${
        item.action === "kt" ? "Открыть таблицу KT_ЧУТ" : "Открыть таблицу VT"
      }</button>`
    : "";

  panel.innerHTML = `
    <div class="inspector-copy">
      <strong>${esc(item.title)}</strong>
      <span>${esc(item.text)}</span>
    </div>
    ${controls ? `<div class="inspector-controls">${controls}</div>` : ""}
    ${action}
  `;
  panel.classList.add("open");
  bindNumericControls(panel);

  const ds = panel.querySelector<HTMLSelectElement>("#formulaDoubleStrike");
  if (ds) {
    ds.addEventListener("change", () => {
      currentConfig.doubleStrikeMode = ds.value as Mcr2026Config["doubleStrikeMode"];
      byId<HTMLSelectElement>("doubleStrikeMode").value = ds.value;
      recalc();
    });
  }

  const actionButton = panel.querySelector<HTMLButtonElement>("#openReferenceAction");
  if (actionButton && item.action) {
    actionButton.addEventListener("click", () => openReference(item.action!));
  }
}

function openReference(kind: string): void {
  const details = document.querySelector<HTMLDetailsElement>(".reference-card")!;
  details.open = true;
  activeReferenceTab = kind === "kt" ? 1 : 2;
  setupTabs();
  details.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

const tabNames = ["Кю/даны ↔ EU", "KT по участникам", "VT / устаревание", "Константы"];

function setupTabs(): void {
  const tabs = document.querySelector<HTMLDivElement>("#tabs");
  if (!tabs) return;

  tabs.innerHTML = tabNames.map((x, i) =>
    `<button data-tab="${i}" class="${i === activeReferenceTab ? "active" : ""}">${x}</button>`
  ).join("");

  tabs.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    activeReferenceTab = Number((button as HTMLButtonElement).dataset.tab);
    setupTabs();
  }));

  renderReference(activeReferenceTab);
}

function renderReference(tab: number): void {
  const panel = document.querySelector<HTMLDivElement>("#referencePanel");
  if (!panel) return;

  if (tab === 0) {
    panel.innerHTML = table(
      ["EU", "Уровень", "Тип"],
      MCR2026_LEVELS.map((x) => [x.eu, x.label, x.kind]),
      "reference-table"
    );
  } else if (tab === 1) {
    panel.innerHTML = `
      <div class="reference-toolbar">
        <label class="switch-row"><input type="checkbox" id="useKt" ${useKtExperiment ? "checked" : ""}>
          <span>Использовать экспериментальную копию</span></label>
        <button id="resetKt">Сбросить</button>
      </div>
      <div class="table-wrap compact-table"><table class="editor-table">
        <thead><tr><th>Участники</th><th>MCR-2026</th><th>Эксперимент</th></tr></thead>
        <tbody>
        ${Object.entries(KT_PARTICIPANTS).map(([n, v]) => `
          <tr><td>${n}</td><td>${Number(v).toFixed(2)}</td>
          <td><input data-kt="${n}" type="number" step="0.05" value="${ktExperiment[Number(n)].toFixed(2)}"></td></tr>`
        ).join("")}
        </tbody>
      </table></div>`;

    panel.querySelector<HTMLInputElement>("#useKt")!.addEventListener("change", (e) => {
      useKtExperiment = (e.currentTarget as HTMLInputElement).checked;
      recalc();
    });
    panel.querySelector("#resetKt")!.addEventListener("click", () => {
      ktExperiment = { ...KT_PARTICIPANTS };
      useKtExperiment = false;
      renderReference(1);
      recalc();
    });
    panel.querySelectorAll<HTMLInputElement>("[data-kt]").forEach((el) =>
      el.addEventListener("change", () => {
        ktExperiment[Number(el.dataset.kt)] = Number(el.value);
        recalc();
      })
    );
  } else if (tab === 2) {
    panel.innerHTML = `
      <div class="reference-toolbar">
        <label class="switch-row"><input type="checkbox" id="useVt" ${useVtExperiment ? "checked" : ""}>
          <span>Использовать экспериментальную таблицу</span></label>
        <button id="resetVt">Сбросить</button>
      </div>
      <div class="table-wrap compact-table"><table class="editor-table">
        <thead><tr><th>Период</th><th>MCR-2026</th><th>Эксперимент</th></tr></thead>
        <tbody>
        ${MCR2026_AGE_WEIGHTS.map((x, i) => `
          <tr><td>${x.minMonths}–${x.maxMonths ?? "∞"} мес.</td><td>${x.weight.toFixed(2)}</td>
          <td><input data-vt="${i}" type="number" min="0" max="2" step="0.01" value="${vtExperiment[i].weight.toFixed(2)}"></td></tr>`
        ).join("")}
        </tbody>
      </table></div>`;

    panel.querySelector<HTMLInputElement>("#useVt")!.addEventListener("change", (e) => {
      useVtExperiment = (e.currentTarget as HTMLInputElement).checked;
      recalc();
    });
    panel.querySelector("#resetVt")!.addEventListener("click", () => {
      vtExperiment = MCR2026_AGE_WEIGHTS.map((x) => ({ ...x }));
      useVtExperiment = false;
      renderReference(2);
      recalc();
    });
    panel.querySelectorAll<HTMLInputElement>("[data-vt]").forEach((el) =>
      el.addEventListener("change", () => {
        vtExperiment[Number(el.dataset.vt)].weight = Number(el.value);
        recalc();
      })
    );
  } else {
    panel.innerHTML = table(
      ["Параметр", "MCR-2026"],
      Object.entries(MCR2026_DEFAULTS).map(([k, v]) => [k, String(v)]),
      "reference-table"
    );
  }
}

function table(headers: string[], rows: (string | number)[][], cls = ""): string {
  return `<div class="table-wrap compact-table"><table class="${cls}">
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}


type DiffRow = NonNullable<CalculationResult["ranking"][number]> & {
  refRating: number;
  deltaRating: number;
  deltaRank: number;
};

function getDiffRows(): DiffRow[] {
  if (!current || !reference) return [];
  const refById = new Map(reference.ranking.map((x) => [x.playerId, x]));
  return current.ranking.map((x) => {
    const ref = refById.get(x.playerId);
    return {
      ...x,
      refRating: ref?.rating ?? Number.NaN,
      deltaRating: ref ? x.rating - ref.rating : Number.NaN,
      deltaRank: ref ? ref.rank - x.rank : 0,
    };
  });
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") {
    const aa = Number.isNaN(a) ? Number.NEGATIVE_INFINITY : a;
    const bb = Number.isNaN(b) ? Number.NEGATIVE_INFINITY : b;
    return aa - bb;
  }
  return String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" });
}

function sortRankingRows(rows: DiffRow[]): DiffRow[] {
  const dir = rankingSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[rankingSortKey];
    const bv = b[rankingSortKey];
    const cmp = compareValues(av as string | number, bv as string | number);
    return cmp * dir || a.rank - b.rank;
  });
}

function sortHeader(label: string, key: RankingSortKey, extraClass = ""): string {
  const active = rankingSortKey === key;
  const arrow = active ? (rankingSortDir === "asc" ? "▲" : "▼") : "↕";
  return `<th class="${extraClass}">
    <button class="sort-button ${active ? "active" : ""}" data-sort-key="${key}" type="button">
      <span>${esc(label)}</span><span class="sort-arrow">${arrow}</span>
    </button>
  </th>`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob(["\uFEFF", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportRankingCsv(): void {
  const rows = getDiffRows();
  const headers = [
    "rank", "player_id", "player_name", "level", "eu", "marks",
    "t5", "rating", "reference_rating", "delta_rating", "delta_rank", "tournaments_count",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((x) => [
      x.rank, x.playerId, x.playerName, x.level, x.currentEu, x.marks,
      x.t5.toFixed(4), x.rating.toFixed(4),
      Number.isFinite(x.refRating) ? x.refRating.toFixed(4) : "",
      Number.isFinite(x.deltaRating) ? x.deltaRating.toFixed(4) : "",
      x.deltaRank, x.tournamentsCount,
    ].map(csvCell).join(",")),
  ];
  const date = byId<HTMLInputElement>("evaluationDate")?.value || todayIso();
  downloadTextFile(`mcr-rating-${date}.csv`, lines.join("\r\n"));
}

function deltaMiniTable(title: string, rows: DiffRow[], kind: "positive" | "negative"): string {
  return `
    <div class="delta-card ${kind}">
      <div class="delta-card-title">${esc(title)}</div>
      <table class="delta-table">
        <thead><tr><th>Игрок</th><th>Δ Rating</th><th>Δ место</th></tr></thead>
        <tbody>
          ${rows.map((x) => `<tr>
            <td>
              <button class="player-link mini-player-link" data-player-id="${esc(x.playerId)}" type="button">
                ${esc(x.playerName)}
              </button>
            </td>
            <td class="${x.deltaRating > 0 ? "pos" : x.deltaRating < 0 ? "neg" : ""}">
              ${x.deltaRating > 0 ? "+" : ""}${fmt(x.deltaRating)}
            </td>
            <td class="${x.deltaRank > 0 ? "pos" : x.deltaRank < 0 ? "neg" : ""}">
              ${x.deltaRank > 0 ? "+" : ""}${x.deltaRank}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function playerDetailHtml(
  playerId: string,
  result: CalculationResult = current!,
  topN = currentConfig.topN,
): string {
  if (!result) return "";

  const rankingRow = result.ranking.find((x) => x.playerId === playerId);
  if (!rankingRow) return "";

  const rows = result.tournamentRows
    .filter((x) => x.playerId === playerId)
    .sort((a, b) =>
      b.tournamentDate.localeCompare(a.tournamentDate)
      || b.nrktvt - a.nrktvt
    );

  const topIds = new Set(
    [...rows]
      .sort((a, b) => b.nrktvt - a.nrktvt)
      .slice(0, topN)
      .map((x) => `${x.tournamentId}|${x.tournamentDate}`)
  );

  if (!rows.length) {
    return `<div class="player-detail-empty">У игрока нет турнирных результатов в текущем наборе данных.</div>`;
  }

  return `
    <div class="player-detail">
      <div class="player-detail-head">
        <div>
          <strong>${esc(rankingRow.playerName)}</strong>
          <span>${esc(rankingRow.level)} · EU ${rankingRow.currentEu} · T5 ${fmt(rankingRow.t5, 1)}</span>
        </div>
        <span class="micro">${rows.length} турниров · ★ входит в top-${topN}</span>
      </div>
      <div class="table-wrap player-history-wrap">
        <table class="player-history-table">
          <thead><tr>
            <th></th>
            <th>Дата</th>
            <th>Турнир</th>
            <th>Место</th>
            <th>ЧУТ</th>
            <th>Сессии</th>
            <th>EU до</th>
            <th>EU после</th>
            <th>Уровень после</th>
            <th>NR</th>
            <th>KT</th>
            <th>VT</th>
            <th>NR·KT</th>
            <th>NR·KT·VT</th>
          </tr></thead>
          <tbody>
            ${rows.map((x) => {
              const top = topIds.has(`${x.tournamentId}|${x.tournamentDate}`);
              return `<tr class="${top ? "top-contribution" : ""}">
                <td class="top-marker">${top ? "★" : ""}</td>
                <td>${esc(x.tournamentDate)}</td>
                <td class="tournament-name-cell" title="${esc(x.tournamentName)}">${esc(x.tournamentName)}</td>
                <td>${x.place}</td>
                <td>${x.participants}</td>
                <td>${x.sessions}</td>
                <td>${x.euBefore}</td>
                <td>${x.euAfter}</td>
                <td>${esc(x.levelAfter)}</td>
                <td>${fmt(x.nr, 1)}</td>
                <td>${fmt(x.kt)}</td>
                <td>${fmt(x.vt)}</td>
                <td>${fmt(x.nrkt, 1)}</td>
                <td class="emph">${fmt(x.nrktvt, 1)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}
function bindRankingInteractions(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sortKey as RankingSortKey;
      if (rankingSortKey === key) {
        rankingSortDir = rankingSortDir === "asc" ? "desc" : "asc";
      } else {
        rankingSortKey = key;
        rankingSortDir = key === "playerName" || key === "level" ? "asc" : "desc";
      }
      renderOutput();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-player-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const playerId = button.dataset.playerId!;
      expandedPlayerId = expandedPlayerId === playerId ? null : playerId;
      renderOutput();

      if (expandedPlayerId) {
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-expanded-player="${CSS.escape(expandedPlayerId!)}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
    });
  });
}

function renderRrLabOutput(): void {
  if (!rrCurrent || !rrReference) {
    const ranking=document.querySelector<HTMLElement>("#ranking"); if(ranking) ranking.innerHTML=`<div class="notice error">RR не удалось рассчитать для текущего набора/конфигурации.</div>`; return;
  }
  const metrics=document.querySelector<HTMLElement>("#metrics");
  const leaders=document.querySelector<HTMLElement>("#deltaLeaders");
  const ranking=document.querySelector<HTMLElement>("#ranking");
  if(!metrics||!leaders||!ranking)return;
  const ref=new Map(rrReference.ranking.map((x)=>[x.playerId,x]));
  let rows=rrCurrent.ranking.map((x)=>{const r=ref.get(x.playerId);return {...x,refRank:r?.rank??null,refRating:r?.rating??null,deltaRank:r? r.rank-x.rank:null,deltaRating:r?x.rating-r.rating:null};});
  const q=rankingSearch.trim().toLocaleLowerCase("ru"); if(q)rows=rows.filter((x)=>[x.playerName,x.playerId].some((v)=>String(v).toLocaleLowerCase("ru").includes(q)));
  const changed=rows.filter((x)=>x.deltaRank!==null&&x.deltaRank!==0).length;
  const mean=rows.length?rows.reduce((a,x)=>a+Math.abs(x.deltaRank??0),0)/rows.length:0;
  metrics.innerHTML=`<div class="metric-chip"><span>Игроков</span><strong>${rrCurrent.ranking.length}</strong></div><div class="metric-chip"><span>Изменили место</span><strong>${changed}</strong></div><div class="metric-chip"><span>Среднее |Δ места|</span><strong>${fmt(mean,1)}</strong></div>`;
  leaders.innerHTML = (rrCurrent.diagnostics?.length ?? 0)
    ? diagnosticSummaryHtml("RR / текущая конфигурация", rrCurrent, "rr")
    : "";
  const count=document.getElementById("rankingVisibleCount"); if(count)count.textContent=`${rows.length} игроков`;
  ranking.innerHTML=`<div class="table-wrap ranking-wrap"><table class="ranking-table"><thead><tr><th>#</th><th>Игрок</th><th>RR</th><th>A</th><th>B</th><th>Турниров</th><th>RR default</th><th>Δ RR</th><th>Δ место</th></tr></thead><tbody>${rows.map((x)=>`<tr><td>${x.rank}</td><td>${esc(x.playerName)}</td><td class="emph">${fmt(x.rating)}</td><td>${fmt(x.firstPart)}</td><td>${fmt(x.secondPart)}</td><td>${x.tournamentsCount}</td><td>${x.refRating===null?"—":fmt(x.refRating)}</td><td>${x.deltaRating===null?"—":`${x.deltaRating>=0?"+":""}${fmt(x.deltaRating)}`}</td><td>${x.deltaRank===null?"—":`${x.deltaRank>=0?"+":""}${x.deltaRank}`}</td></tr>`).join("")}</tbody></table></div>`;
}

function exportRrRankingCsv(): void {
  if(!rrCurrent)return;
  const lines=["rank,player_id,player_name,rr,A,B,tournaments",...rrCurrent.ranking.map((x)=>[x.rank,x.playerId,`"${String(x.playerName).replaceAll('"','""')}"`,x.rating,x.firstPart,x.secondPart,x.tournamentsCount].join(","))];
  const blob=new Blob(["\\uFEFF"+lines.join("\\n")],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob); const a=document.createElement("a");a.href=url;a.download="rr_ranking.csv";a.click();URL.revokeObjectURL(url);
}

function renderOutput(): void {
  if (activeLabMethod === "rr") { renderRrLabOutput(); return; }
  if (!current || !reference) {
    const ranking=document.querySelector<HTMLElement>("#ranking"); if(ranking) ranking.innerHTML=`<div class="notice error">MCR не удалось рассчитать для текущего набора/конфигурации.</div>`; return;
  }

  syncAllControlValues();

  const diffs = getDiffRows();
  const changed = diffs.filter((x) => x.deltaRank !== 0).length;
  const validDelta = diffs.map((x) => x.deltaRating).filter(Number.isFinite);
  const meanAbs = validDelta.length
    ? validDelta.reduce((s, x) => s + Math.abs(x), 0) / validDelta.length
    : 0;
  const maxUp = validDelta.length ? Math.max(...validDelta) : 0;
  const maxDown = validDelta.length ? Math.min(...validDelta) : 0;

  const metrics = document.querySelector("#metrics")!;
  metrics.innerHTML = [
    ["Изменили место", changed],
    ["Среднее |Δ|", fmt(meanAbs)],
    ["Макс. рост", `${maxUp >= 0 ? "+" : ""}${fmt(maxUp)}`],
    ["Макс. падение", fmt(maxDown)],
  ].map(([k, v]) =>
    `<div class="metric-chip"><span>${k}</span><strong>${v}</strong></div>`
  ).join("");

  const positive = [...diffs]
    .filter((x) => Number.isFinite(x.deltaRating) && x.deltaRating > 0)
    .sort((a, b) => b.deltaRating - a.deltaRating)
    .slice(0, 5);
  const negative = [...diffs]
    .filter((x) => Number.isFinite(x.deltaRating) && x.deltaRating < 0)
    .sort((a, b) => a.deltaRating - b.deltaRating)
    .slice(0, 5);

  const deltaLeaders = document.querySelector<HTMLDivElement>("#deltaLeaders")!;
  deltaLeaders.innerHTML =
    ((current.diagnostics?.length ?? 0) ? diagnosticSummaryHtml("MCR / текущая конфигурация", current, "mcr") : "")
    + deltaMiniTable("Наибольший рост", positive, "positive")
    + deltaMiniTable("Наибольшее падение", negative, "negative");

  const query = rankingSearch.trim().toLocaleLowerCase("ru");
  const filtered = diffs.filter((x) => {
    if (!query) return true;
    return [
      x.playerName,
      x.playerId,
      x.level,
      String(x.currentEu),
      String(x.rank),
    ].some((value) => String(value).toLocaleLowerCase("ru").includes(query));
  });
  const shown = sortRankingRows(filtered);

  const countEl = document.querySelector<HTMLElement>("#rankingVisibleCount");
  if (countEl) {
    countEl.textContent = query
      ? `Показано ${shown.length} из ${diffs.length}`
      : `${diffs.length} игроков`;
  }

  document.querySelector("#ranking")!.innerHTML = `
    <div class="table-wrap ranking-wrap">
      <table class="ranking-table">
        <thead><tr>
          ${sortHeader("#", "rank", "rank-col")}
          ${sortHeader("Игрок", "playerName", "player-col")}
          ${sortHeader("Уровень", "level")}
          ${sortHeader("EU", "currentEu")}
          ${sortHeader("Турниров", "tournamentsCount")}
          ${sortHeader("T5", "t5")}
          ${sortHeader("Rating", "rating")}
          ${sortHeader("Эталон", "refRating")}
          ${sortHeader("Δ Rating", "deltaRating")}
          ${sortHeader("Δ место", "deltaRank")}
        </tr></thead>
        <tbody>
          ${shown.length ? shown.map((x) => `
            <tr class="${expandedPlayerId === x.playerId ? "expanded-player-row" : ""}">
              <td>${x.rank}</td>
              <td class="player-name-cell">
                <button class="player-link" data-player-id="${esc(x.playerId)}" type="button"
                  title="${esc(x.playerName)}">
                  <span>${esc(x.playerName)}</span>
                  <span class="player-expand-icon">${expandedPlayerId === x.playerId ? "▾" : "›"}</span>
                </button>
              </td>
              <td>${esc(x.level)}</td>
              <td>${x.currentEu}</td>
              <td>${x.tournamentsCount}</td>
              <td>${fmt(x.t5, 1)}</td>
              <td class="emph">${fmt(x.rating)}</td>
              <td>${fmt(x.refRating)}</td>
              <td class="${x.deltaRating > 0 ? "pos" : x.deltaRating < 0 ? "neg" : ""}">
                ${x.deltaRating >= 0 ? "+" : ""}${fmt(x.deltaRating)}
              </td>
              <td class="${x.deltaRank > 0 ? "pos" : x.deltaRank < 0 ? "neg" : ""}">
                ${x.deltaRank >= 0 ? "+" : ""}${x.deltaRank}
              </td>
            </tr>
            ${expandedPlayerId === x.playerId ? `
              <tr class="player-detail-row" data-expanded-player="${esc(x.playerId)}">
                <td colspan="10">${playerDetailHtml(x.playerId)}</td>
              </tr>
            ` : ""}
          `).join("") : `
            <tr class="empty-ranking-row"><td colspan="10">По этому запросу игроков не найдено.</td></tr>
          `}
        </tbody>
      </table>
    </div>`;

  bindRankingInteractions();
}


function setWorkspace(workspace: "comparison" | "lab"): void {
  activeWorkspace = workspace;
  document.getElementById("comparisonWorkspace")?.classList.toggle("active", workspace === "comparison");
  document.getElementById("labWorkspace")?.classList.toggle("active", workspace === "lab");
  document.getElementById("workspaceComparison")?.classList.toggle("active", workspace === "comparison");
  document.getElementById("workspaceLab")?.classList.toggle("active", workspace === "lab");
  if (workspace === "comparison") { renderComparison(); renderHistoryWorkspace(); }
}

function historyOverrides(): TableOverrides {
  const overrides: TableOverrides = {};
  if (useKtExperiment) overrides.ktParticipants = ktExperiment;
  if (useVtExperiment) overrides.ageWeights = vtExperiment;
  return overrides;
}

function historyMethodOptions(): Array<{ id: string; label: string; method: "mcr"|"rr"; preset?: SavedLabPreset }> {
  const base = [
    { id: "mcr-default", label: "MCR-2026 default", method: "mcr" as const },
    { id: "rr-default", label: "RR default", method: "rr" as const },
  ];
  return base.concat(loadPresets().map((preset) => ({
    id: `preset:${preset.id}`,
    label: `${preset.name} · ${preset.method.toUpperCase()}`,
    method: preset.method,
    preset,
  })));
}

function historyMethodLabel(id: string): string {
  return historyMethodOptions().find((x) => x.id === id)?.label ?? id;
}

function historyEventKey(event: { tournamentDate: string; tournamentOrder: number; tournamentId: string }): string {
  return `${event.tournamentDate}\u0000${event.tournamentOrder}\u0000${event.tournamentId}`;
}

function orderedHistoryEvents() {
  if (orderedEventsCacheRevision === datasetRevision) return orderedEventsCache;
  const map = new Map<string, UnifiedHistorySnapshot["event"]>();
  const rowMap = new Map<string, ResultInput[]>();
  for (const row of results) {
    const event = {
      tournamentId: String(row.tournament_id), tournamentName: String(row.tournament_name),
      tournamentDate: String(row.tournament_date), tournamentOrder: Number(row.tournament_order ?? 0),
      participants: Number(row.participants), sessions: Number(row.sessions),
      isStatusTournament: Boolean(row.is_status_tournament),
    };
    const key = historyEventKey(event);
    if (!map.has(key)) map.set(key, event);
    const bucket = rowMap.get(key);
    if (bucket) bucket.push(row); else rowMap.set(key, [row]);
  }
  orderedEventsCache = [...map.values()].sort((a,b)=>a.tournamentDate.localeCompare(b.tournamentDate)||a.tournamentOrder-b.tournamentOrder||a.tournamentId.localeCompare(b.tournamentId));
  eventRowsCache = rowMap;
  orderedEventsCacheRevision = datasetRevision;
  return orderedEventsCache;
}

function historyMethodCacheKey(methodId: string): string {
  const option = historyMethodOptions().find((x)=>x.id===methodId) ?? historyMethodOptions()[0];
  const presetStamp = option.preset ? `${option.preset.id}|${option.preset.savedAt}|${stableSerialize(option.preset.payload)}` : "default";
  return `history|${datasetRevision}|${historyInitialMode}|${option.method}|${methodId}|${presetStamp}`;
}

function getHistoryCached(methodId: string): UnifiedHistorySnapshot[] | undefined {
  return historyMethodCache.get(historyMethodCacheKey(methodId));
}

async function buildHistoryForMethodAsync(methodId: string): Promise<UnifiedHistorySnapshot[]> {
  const cacheKey = historyMethodCacheKey(methodId);
  const cached = historyMethodCache.get(cacheKey);
  if (cached) return cached;
  const running = historyInFlight.get(cacheKey);
  if (running) return running;

  const option = historyMethodOptions().find((x)=>x.id===methodId) ?? historyMethodOptions()[0];
  let job: any;
  if (option.method === "mcr") {
    let config = defaultMcr2026Config();
    const overrides: TableOverrides = {};
    if (option.preset) {
      const payload=option.preset.payload ?? {};
      config={...config,...(payload.config ?? {})};
      if(payload.useKtExperiment) overrides.ktParticipants=payload.ktExperiment;
      if(payload.useVtExperiment) overrides.ageWeights=payload.vtExperiment;
    }
    job = { kind: "mcr-history", config, overrides, initialMode: historyInitialMode };
  } else {
    const payload=option.preset?.payload ?? {};
    const config={...defaultRrConfig(),...(payload.config ?? {})};
    const overrides={
      playerBands: payload.playerBands ?? RR_DEFAULT_PLAYER_BANDS,
      sessionBands: payload.sessionBands ?? RR_DEFAULT_SESSION_BANDS,
      tournamentTypeMultipliers: payload.typeMultipliers ?? RR_DEFAULT_TYPE_MULTIPLIERS,
      specialCoefficients: payload.specialCoefficients ?? RR_DEFAULT_SPECIAL_COEFFICIENTS,
    };
    job = { kind: "rr-history", config, overrides };
  }

  const promise = ratingWorkers.run<UnifiedHistorySnapshot[]>(job)
    .then((built) => { historyMethodCache.set(cacheKey, built); return built; })
    .finally(() => historyInFlight.delete(cacheKey));
  historyInFlight.set(cacheKey, promise);
  return promise;
}

function applyHistoryPeriod(rows: UnifiedHistorySnapshot[]): UnifiedHistorySnapshot[] {
  return rows.filter((s)=>(!historyPeriodStart || s.event.tournamentDate>=historyPeriodStart) && (!historyPeriodEnd || s.event.tournamentDate<=historyPeriodEnd))
    .map((s,index)=>({...s,index}));
}

let historyRefreshKey = "";

async function refreshHistorySnapshots(): Promise<void> {
  const requestKey = [datasetRevision, historyInitialMode, historyMethodA, historyMethodB, historyPeriodStart, historyPeriodEnd].join("|");
  if (historyRefreshKey === requestKey) return;
  historyRefreshKey = requestKey;
  const generation = ++historyGeneration;
  try {
    const [a, b] = await Promise.all([
      buildHistoryForMethodAsync(historyMethodA),
      buildHistoryForMethodAsync(historyMethodB),
    ]);
    if (generation !== historyGeneration || historyRefreshKey !== requestKey) return;
    historySnapshots=applyHistoryPeriod(a);
    historyReferenceSnapshots=applyHistoryPeriod(b);
    historyDirty=false;
    historyRefreshKey="";
    if (!historySnapshots.length) { historySnapshotIndex=0; historyPlayerId=null; }
    else {
      historySnapshotIndex=Math.min(historySnapshotIndex,historySnapshots.length-1);
      const latest=historySnapshots[historySnapshots.length-1];
      if(!historyPlayerId || !latest.ranking.some((r)=>r.playerId===historyPlayerId)) historyPlayerId=latest.ranking[0]?.playerId ?? null;
    }
    renderHistoryWorkspace();
    renderDistanceMetrics();
  } catch (error) {
    if (generation !== historyGeneration) return;
    historyRefreshKey="";
    const summary=document.getElementById("historySummary");
    if(summary) summary.innerHTML=`<div class="notice error">${esc(error instanceof Error ? error.message : String(error))}</div>`;
  }
}

function renderHistorySettings(): void {
  const host=byId("historySettingsPanel");
  if(!historySettingsOpen){host.innerHTML="";return;}
  if(historySettingsOpen==="methods"){
    const opts=historyMethodOptions();
    const options=(selected:string)=>opts.map((o)=>`<option value="${esc(o.id)}" ${o.id===selected?"selected":""}>${esc(o.label)}</option>`).join("");
    host.innerHTML=`<section class="history-card history-settings-card"><div class="history-settings-head"><strong>Методы для сравнения</strong><button id="closeHistorySettings" type="button">×</button></div><div class="history-settings-grid"><label>Метод 1<select id="historyMethodASelect">${options(historyMethodA)}</select></label><label>Метод 2<select id="historyMethodBSelect">${options(historyMethodB)}</select></label></div></section>`;
    byId<HTMLSelectElement>("historyMethodASelect").onchange=(e)=>{historyMethodA=(e.currentTarget as HTMLSelectElement).value;historyDirty=true;historySnapshotIndex=0;renderHistoryWorkspace();};
    byId<HTMLSelectElement>("historyMethodBSelect").onchange=(e)=>{historyMethodB=(e.currentTarget as HTMLSelectElement).value;historyDirty=true;historySnapshotIndex=0;renderHistoryWorkspace();};
  } else {
    const all=orderedHistoryEvents(); const min=all[0]?.tournamentDate??""; const max=all[all.length-1]?.tournamentDate??"";
    host.innerHTML=`<section class="history-card history-settings-card"><div class="history-settings-head"><strong>Период истории</strong><button id="closeHistorySettings" type="button">×</button></div><div class="history-settings-grid"><label>Начало<input id="historyPeriodStart" type="date" min="${min}" max="${max}" value="${esc(historyPeriodStart||min)}"></label><label>Конец<input id="historyPeriodEnd" type="date" min="${min}" max="${max}" value="${esc(historyPeriodEnd||max)}"></label><button id="resetHistoryPeriod" type="button">Весь период</button></div></section>`;
    byId<HTMLInputElement>("historyPeriodStart").onchange=(e)=>{historyPeriodStart=(e.currentTarget as HTMLInputElement).value;historyDirty=true;historySnapshotIndex=0;renderHistoryWorkspace();};
    byId<HTMLInputElement>("historyPeriodEnd").onchange=(e)=>{historyPeriodEnd=(e.currentTarget as HTMLInputElement).value;historyDirty=true;historySnapshotIndex=0;renderHistoryWorkspace();};
    byId<HTMLButtonElement>("resetHistoryPeriod").onclick=()=>{historyPeriodStart="";historyPeriodEnd="";historyDirty=true;historySnapshotIndex=0;renderHistoryWorkspace();};
  }
  byId<HTMLButtonElement>("closeHistorySettings").onclick=()=>{historySettingsOpen=null;renderHistorySettings();};
}

function renderHistoryWorkspace(): void {
  const summary=byId("historySummary"), slider=byId<HTMLInputElement>("historySlider"), ticks=byId("historyTicks"), select=byId<HTMLSelectElement>("historyPlayerSelect");
  if (historyDirty) {
    summary.innerHTML=`<div class="notice">Расчёт истории в фоновых очередях…</div>`;
    ticks.innerHTML=""; select.innerHTML=""; byId("historyPlayerChart").innerHTML=""; byId("historySnapshotPanel").innerHTML="";
    slider.min="0"; slider.max="0"; slider.value="0";
    renderHistorySettings();
    void refreshHistorySnapshots();
    return;
  }
  if(!historySnapshots.length){summary.innerHTML=`<div class="notice">Нет турниров для выбранного периода.</div>`;ticks.innerHTML="";select.innerHTML="";byId("historyPlayerChart").innerHTML="";byId("historySnapshotPanel").innerHTML="";slider.min="0";slider.max="0";slider.value="0";renderHistorySettings();return;}
  const first=historySnapshots[0].event,last=historySnapshots[historySnapshots.length-1].event;
  summary.innerHTML=`<div class="history-stat"><span>Турниров</span><strong>${historySnapshots.length}</strong></div>
    <button class="history-stat history-stat-button" id="historyPeriodButton" type="button"><span>Период</span><strong>${esc(first.tournamentDate)} → ${esc(last.tournamentDate)}</strong></button>
    <div class="history-stat"><span>Старт</span><strong>${historyInitialMode==="clean"?"чистый":"импортированный EU"}</strong></div>
    <button class="history-stat history-stat-button" id="historyMethodsButton" type="button"><span>Методы</span><strong>${esc(historyMethodLabel(historyMethodA))} / ${esc(historyMethodLabel(historyMethodB))}</strong></button>`;
  byId<HTMLButtonElement>("historyPeriodButton").onclick=()=>{historySettingsOpen=historySettingsOpen==="period"?null:"period";renderHistorySettings();};
  byId<HTMLButtonElement>("historyMethodsButton").onclick=()=>{historySettingsOpen=historySettingsOpen==="methods"?null:"methods";renderHistorySettings();};
  byId("historyChartMethodsLabel").textContent=`${historyMethodLabel(historyMethodA)} ↔ ${historyMethodLabel(historyMethodB)}`;
  renderHistorySettings();
  slider.min="0";slider.max=String(historySnapshots.length-1);slider.value=String(historySnapshotIndex);
  ticks.innerHTML=historySnapshots.map((snap,i)=>`<button type="button" class="timeline-tick ${i===historySnapshotIndex?"active":""}" data-history-index="${i}" title="${esc(snap.event.tournamentDate)} · ${esc(snap.event.tournamentName)}"><span></span></button>`).join("");
  ticks.querySelectorAll<HTMLButtonElement>("[data-history-index]").forEach((b)=>b.onclick=()=>{historySnapshotIndex=Number(b.dataset.historyIndex);historyExpandedPlayerId=null;slider.value=String(historySnapshotIndex);renderHistoryWorkspace();});
  const latestPlayers=historySnapshots[historySnapshots.length-1].ranking;
  select.innerHTML=latestPlayers.map((row)=>`<option value="${esc(row.playerId)}" ${row.playerId===historyPlayerId?"selected":""}>${esc(row.playerName)} · #${row.rank}</option>`).join("");
  renderHistoryPlayerChart();renderHistorySnapshot();
}

function historySeriesForPlayer(snapshots: UnifiedHistorySnapshot[],playerId:string){
  const points:{index:number;rank:number;rating:number;date:string}[]=[];
  snapshots.forEach((snapshot,index)=>{const row=snapshot.ranking.find((x)=>x.playerId===playerId);if(row)points.push({index,rank:row.rank,rating:row.rating,date:snapshot.event.tournamentDate});});return points;
}

function svgPolyline(series:{index:number;rank:number}[],maxIndex:number,maxRank:number,width:number,height:number,padX:number,padY:number):string{
  if(!series.length)return"";const innerW=width-padX*2,innerH=height-padY*2;return series.map((p)=>{const x=padX+(maxIndex>0?(p.index/maxIndex)*innerW:innerW/2);const y=padY+(maxRank>1?((p.rank-1)/(maxRank-1))*innerH:innerH/2);return`${x.toFixed(1)},${y.toFixed(1)}`;}).join(" ");
}

function renderHistoryPlayerChart():void{
  const host=byId("historyPlayerChart");if(!historyPlayerId||!historySnapshots.length){host.innerHTML=`<div class="micro">Выберите игрока.</div>`;return;}
  const a=historySeriesForPlayer(historySnapshots,historyPlayerId),b=historySeriesForPlayer(historyReferenceSnapshots,historyPlayerId);
  const latest=historySnapshots[historySnapshots.length-1].ranking.find((x)=>x.playerId===historyPlayerId);const name=latest?.playerName??historyPlayerId;
  const maxIndex=Math.max(1,historySnapshots.length-1),maxRank=Math.max(2,...a.map(x=>x.rank),...b.map(x=>x.rank));const width=1000,height=220,padX=46,padY=22;
  const aPoints=svgPolyline(a,maxIndex,maxRank,width,height,padX,padY),bPoints=svgPolyline(b,maxIndex,maxRank,width,height,padX,padY);const selectedX=padX+(historySnapshotIndex/maxIndex)*(width-padX*2);
  const selectedA=historySnapshots[historySnapshotIndex]?.ranking.find((x)=>x.playerId===historyPlayerId);const selectedB=historyReferenceSnapshots[historySnapshotIndex]?.ranking.find((x)=>x.playerId===historyPlayerId);
  host.innerHTML=`<div class="chart-head"><strong>${esc(name)}</strong><div class="chart-legend"><span><i class="legend-line experimental"></i>${esc(historyMethodLabel(historyMethodA))}</span><span><i class="legend-line reference"></i>${esc(historyMethodLabel(historyMethodB))}</span></div></div>
    <svg class="history-chart" viewBox="0 0 ${width} ${height}" role="img"><line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height-padY}" class="chart-axis"/><line x1="${padX}" y1="${height-padY}" x2="${width-padX}" y2="${height-padY}" class="chart-axis"/><text x="8" y="${padY+4}" class="chart-label">#1</text><text x="8" y="${height-padY+4}" class="chart-label">#${maxRank}</text><line x1="${selectedX}" y1="${padY}" x2="${selectedX}" y2="${height-padY}" class="chart-cursor"/>${bPoints?`<polyline points="${bPoints}" class="chart-series reference"/>`:""}${aPoints?`<polyline points="${aPoints}" class="chart-series experimental"/>`:""}</svg>
    <div class="chart-selected"><span>Точка ${historySnapshotIndex+1}/${historySnapshots.length}</span><span>${esc(historyMethodLabel(historyMethodA))}: <strong>${selectedA?`#${selectedA.rank} · ${fmt(selectedA.rating)}`:"—"}</strong></span><span>${esc(historyMethodLabel(historyMethodB))}: <strong>${selectedB?`#${selectedB.rank} · ${fmt(selectedB.rating)}`:"—"}</strong></span></div>`;
}

function historySortHeader(label:string,key:string):string{const active=historyTableSortKey===key;const arrow=active?(historyTableSortDir==="asc"?" ↑":" ↓"):"";return`<button class="sort-header" data-history-table-sort="${esc(key)}" type="button">${esc(label)}${arrow}</button>`;}

function renderHistorySnapshot():void{
  if(!historySnapshots.length)return;const snapshot=historySnapshots[historySnapshotIndex],other=historyReferenceSnapshots[historySnapshotIndex];const previous=historySnapshotIndex>0?historySnapshots[historySnapshotIndex-1]:null;
  const previousById=new Map((previous?.ranking??[]).map(r=>[r.playerId,r]));const otherById=new Map((other?.ranking??[]).map(r=>[r.playerId,r]));
  const movers=snapshot.ranking.map(row=>{const before=previousById.get(row.playerId);return{...row,movement:before?before.rank-row.rank:0,previousRank:before?.rank??null};}).sort((a,b)=>Math.abs(b.movement)-Math.abs(a.movement)||a.rank-b.rank);
  let tableRows=snapshot.ranking.map((row)=>{const b=otherById.get(row.playerId);return{playerId:row.playerId,playerName:row.playerName,rankA:row.rank,ratingA:row.rating,tournamentsCount:row.tournamentsCount,rankB:b?.rank??null,ratingB:b?.rating??null,deltaRating:b?row.rating-b.rating:null,deltaRank:b?b.rank-row.rank:null};});
  tableRows.sort((a:any,b:any)=>{const av=a[historyTableSortKey],bv=b[historyTableSortKey];if(av===null||av===undefined)return 1;if(bv===null||bv===undefined)return-1;const cmp=typeof av==="string"?String(av).localeCompare(String(bv),"ru"):Number(av)-Number(bv);return historyTableSortDir==="asc"?cmp:-cmp;});
  byId<HTMLInputElement>("historySlider").value=String(historySnapshotIndex);document.querySelectorAll(".timeline-tick").forEach((el,i)=>el.classList.toggle("active",i===historySnapshotIndex));
  const nameA=historyMethodLabel(historyMethodA),nameB=historyMethodLabel(historyMethodB);
  byId("historySnapshotPanel").innerHTML=`<div class="snapshot-head"><div><div class="snapshot-step">Шаг ${historySnapshotIndex+1} из ${historySnapshots.length}</div><h2>${esc(snapshot.event.tournamentName)}</h2><div class="reference-labels"><span>${esc(snapshot.event.tournamentDate)}</span><span>${snapshot.event.participants} игроков</span><span>${snapshot.event.sessions} сессий</span><span>${esc(nameA)} ↔ ${esc(nameB)}</span></div></div></div>
    <div class="snapshot-grid"><div><div class="snapshot-subtitle">Наибольшие движения после турнира · ${esc(nameA)}</div><div class="table-wrap snapshot-movers-wrap"><table class="snapshot-table"><thead><tr><th>Игрок</th><th>До</th><th>После</th><th>Δ место</th><th>Rating</th></tr></thead><tbody>${movers.slice(0,10).map(row=>`<tr><td>${esc(row.playerName)}</td><td>${row.previousRank?`#${row.previousRank}`:"new"}</td><td>#${row.rank}</td><td class="${row.movement>0?"pos":row.movement<0?"neg":""}">${row.movement>0?"+":""}${row.movement}</td><td>${fmt(row.rating)}</td></tr>`).join("")}</tbody></table></div></div>
      <div><div class="snapshot-subtitle snapshot-title-row"><span>Рейтинг после этого шага</span><button id="exportHistorySnapshotCsv" class="download-button" type="button">↓ CSV</button></div><div class="table-wrap snapshot-ranking-wrap"><table class="ranking-table snapshot-ranking-table"><thead><tr><th>${historySortHeader(`# ${nameA}`,"rankA")}</th><th>${historySortHeader("Игрок","playerName")}</th><th>${historySortHeader(`Rating · ${nameA}`,"ratingA")}</th><th>${historySortHeader(`# ${nameB}`,"rankB")}</th><th>${historySortHeader(`Rating · ${nameB}`,"ratingB")}</th><th>${historySortHeader("Δ Rating","deltaRating")}</th><th>${historySortHeader("Δ место","deltaRank")}</th></tr></thead><tbody>${tableRows.map((row:any)=>`<tr><td>${row.rankA}</td><td>${esc(row.playerName)}</td><td class="emph">${fmt(row.ratingA)}</td><td>${row.rankB??"—"}</td><td>${row.ratingB===null?"—":fmt(row.ratingB)}</td><td class="${row.deltaRating>0?"pos":row.deltaRating<0?"neg":""}">${row.deltaRating===null?"—":`${row.deltaRating>=0?"+":""}${fmt(row.deltaRating)}`}</td><td class="${row.deltaRank>0?"pos":row.deltaRank<0?"neg":""}">${row.deltaRank===null?"—":`${row.deltaRank>=0?"+":""}${row.deltaRank}`}</td></tr>`).join("")}</tbody></table></div></div></div>`;
  const panel=byId("historySnapshotPanel");panel.querySelectorAll<HTMLButtonElement>("[data-history-table-sort]").forEach((b)=>b.onclick=()=>{const key=b.dataset.historyTableSort!;if(historyTableSortKey===key)historyTableSortDir=historyTableSortDir==="asc"?"desc":"asc";else{historyTableSortKey=key;historyTableSortDir="asc";}renderHistorySnapshot();});
  byId<HTMLButtonElement>("exportHistorySnapshotCsv").onclick=()=>{const lines=[["player_id","player_name",`rank_${nameA}`,`rating_${nameA}`,`rank_${nameB}`,`rating_${nameB}`,"delta_rating_A_minus_B","delta_rank_B_minus_A"].map(csvCell).join(","),...tableRows.map((r:any)=>[r.playerId,r.playerName,r.rankA,r.ratingA,r.rankB??"",r.ratingB??"",r.deltaRating??"",r.deltaRank??""].map(csvCell).join(","))];downloadTextFile(`history-comparison-${snapshot.event.tournamentDate}-${snapshot.event.tournamentId}.csv`,lines.join("\r\n"));};
  renderHistoryPlayerChart();
}

async function loadFiles(): Promise<void> {
  const pf = byId<HTMLInputElement>("playersFile").files?.[0];
  const rf = byId<HTMLInputElement>("resultsFile").files?.[0];
  if (!pf || !rf) {
    setStatus("Нужно выбрать оба CSV", false);
    return;
  }

  try {
    const [pt, rt] = await Promise.all([pf.text(), rf.text()]);
    players = playersFromCsv(pt);
    results = resultsFromCsv(rt);
    markDatasetChanged();
    dataLabel = `${pf.name} + ${rf.name}`;
    byId("dataLabel").textContent = dataLabel;
    recalc();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), false);
  }
}

async function loadBuiltin(): Promise<void> {
  try {
    setStatus("Загрузка встроенного набора…", true);
    const data = await loadCsvPair(
      "/data/players_demo.csv",
      "/data/results_demo.csv",
    );
    players = data.players;
    results = data.results;
    markDatasetChanged();
    dataLabel = "встроенный demo dataset";
    byId("dataLabel").textContent = dataLabel;
    recalc();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), false);
  }
}

renderShell();
loadBuiltin();
