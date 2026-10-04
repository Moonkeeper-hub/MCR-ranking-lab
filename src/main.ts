
import "./styles.css";
import "katex/dist/katex.min.css";
import { renderMcr2026Math } from "./ui/formulas";
import { Mcr2026Engine, defaultMcr2026Config } from "./engine/legacy";
import { simulateMcr2026History } from "./engine/simulation";
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
let dataLabel = "встроенный demo dataset";
let activeFormulaToken: string | null = null;
let activeReferenceTab = 0;

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

let activeWorkspace: "lab" | "history" = "lab";
let historyInitialMode: InitialStateMode = "clean";
let historySnapshots: RatingSnapshot[] = [];
let historyReferenceSnapshots: RatingSnapshot[] = [];
let historySnapshotIndex = 0;
let historyPlayerId: string | null = null;
let historyExpandedPlayerId: string | null = null;
let historyDirty = true;


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

function recalc(): void {
  const evaluationDate = byId<HTMLInputElement>("evaluationDate")?.value || todayIso();
  const overrides: TableOverrides = {};
  if (useKtExperiment) overrides.ktParticipants = ktExperiment;
  if (useVtExperiment) overrides.ageWeights = vtExperiment;

  try {
    current = new Mcr2026Engine(currentConfig, overrides).calculate(players, results, evaluationDate);
    reference = new Mcr2026Engine(defaultMcr2026Config()).calculate(players, results, evaluationDate);
    historyDirty = true;
    syncAllControlValues();
    renderFormulaMath();
    renderOutput();
    if (activeWorkspace === "history") renderHistoryWorkspace();
    const visibleResults = results.filter((r) => String(r.tournament_date) <= evaluationDate).length;
    setStatus(
      `Срез ${evaluationDate}: ${current.ranking.length} игроков, ${visibleResults} результатов`,
      true,
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), false);
  }
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
      recalc();
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

function renderShell(): void {
  app.innerHTML = `
    <div class="app">
      <header class="topbar">
        <div>
          <h1>MCR Rating Lab</h1>
          <div class="subtitle">v0.26 · TypeScript · расчёт выполняется в браузере</div>
        </div>
        <div class="topbar-actions">
          <div class="privacy-pill">CSV остаются на устройстве пользователя</div>
          <div class="support-wrap">
            <button id="supportButton" class="support-button" type="button">Donate / Support</button>
            <div id="supportPopover" class="support-popover" hidden>
              <strong>Поддержать проект</strong>
              <span>Перевод по номеру телефона на Сбербанк</span>
              <div class="support-number-row">
                <code>+7 967 087 1525</code>
                <button id="copySupportNumber" type="button">Копировать</button>
              </div>
              <span id="supportCopyStatus" class="micro"></span>
            </div>
          </div>
        </div>
      </header>

      <nav class="workspace-tabs" aria-label="Режим работы">
        <button id="workspaceLab" class="workspace-tab active" type="button">
          Лаборатория
        </button>
        <button id="workspaceHistory" class="workspace-tab" type="button">
          История / симуляция
        </button>
      </nav>

      <div id="labWorkspace" class="workspace-panel active">
      <div class="layout">
        <aside class="sidebar">
          <section class="side-card">
            <div class="side-title">Эксперимент</div>

            <details class="side-section" open>
              <summary>Данные</summary>
              <div class="section-body compact-stack">
                <div class="notice compact">Источник: <strong id="dataLabel"></strong></div>
                <label class="file-row">players.csv <input id="playersFile" type="file" accept=".csv,text/csv"></label>
                <label class="file-row">results.csv <input id="resultsFile" type="file" accept=".csv,text/csv"></label>
                <div class="button-row">
                  <button id="loadFiles" class="primary">Загрузить</button>
                  <button id="loadBuiltin">Demo dataset</button>
                </div>
                <div id="status" class="micro"></div>
              </div>
            </details>

            <details class="side-section" open>
              <summary>Итоговый рейтинг</summary>
              <div class="section-body">
                ${controlHtml("euWeight", "side")}
                ${controlHtml("t5Weight", "side")}
                ${controlHtml("topN", "side")}
                <div class="sum-note">Σ весов = 1.00</div>
              </div>
            </details>

            <details class="side-section">
              <summary>Коэффициент турнира</summary>
              <div class="section-body">
                ${controlHtml("sessionCoef", "side")}
                ${controlHtml("playerCountScale", "side")}
                ${controlHtml("euComponentScale", "side")}
                ${controlHtml("euNormalizer", "side")}
                ${controlHtml("euRoundStep", "side")}
                ${controlHtml("statusTournamentBonus", "side")}
              </div>
            </details>

            <details class="side-section">
              <summary>Устаревание</summary>
              <div class="section-body">
                ${controlHtml("decayPerQuarter", "side")}
                ${controlHtml("maxAgeMonths", "side")}
              </div>
            </details>

            <details class="side-section">
              <summary>EU / даны</summary>
              <div class="section-body compact-stack">
                <label class="select-row">
                  <span>Double Strike</span>
                  <select id="doubleStrikeMode">
                    <option value="none" ${currentConfig.doubleStrikeMode === "none" ? "selected" : ""}>Нет</option>
                    <option value="A" ${currentConfig.doubleStrikeMode === "A" ? "selected" : ""}>A — полный пересчёт</option>
                    <option value="B" ${currentConfig.doubleStrikeMode === "B" ? "selected" : ""}>B — продолжение первой итерации</option>
                  </select>
                </label>
                <div class="notice compact">
                  <strong>A:</strong> первый проход нужен только для нового EU новичков; затем турнир пересчитывается с исходного состояния.
                  <br><strong>B:</strong> второй проход продолжает первый и может добавить ещё один слой изменений.
                </div>
                <label class="select-row">
                  <span>EU игрока замены</span>
                  <select id="substituteEuPolicy">
                    <option value="zero" ${currentConfig.substituteEuPolicy === "zero" ? "selected" : ""}>0</option>
                    <option value="average" ${currentConfig.substituteEuPolicy === "average" ? "selected" : ""}>Среднее арифметическое</option>
                    <option value="newcomer" ${currentConfig.substituteEuPolicy === "newcomer" ? "selected" : ""}>Считать новичком</option>
                  </select>
                </label>
                <div class="micro">
                  «Считать новичком» включает игрока замены в текущую политику Double Strike.
                </div>
                <label class="switch-row">
                  <input type="checkbox" id="capKyuPromotionAtFirstDan" ${currentConfig.capKyuPromotionAtFirstDan ? "checked" : ""}>
                  <span>Из кю максимум до 1 дана за один турнир</span>
                </label>
                <div class="micro">
                  Если игрок начал турнир на кю, итог этого турнира не может поднять его выше 1 дана (EU 2000), включая Double Strike.
                </div>
                ${controlHtml("successesPerStep", "side")}
                ${controlHtml("failuresPerStep", "side")}
                ${controlHtml("danStep", "side")}
                ${controlHtml("confirmationMonths", "side")}
                ${controlHtml("protectedEu", "side")}
              </div>
            </details>

            <div class="sidebar-footer">
              <label class="date-row">Дата рейтинга
                <input id="evaluationDate" type="date" value="${todayIso()}">
              </label>
              <button id="resetConfig" class="full">Сбросить MCR-2026 к default</button>
            </div>
          </section>
        </aside>

        <main class="main">
          <section class="formula-card">
            <div class="eyebrow-row">
              <div>
                <div class="eyebrow">MCR-2026</div>
                <div class="formula-caption">Основная формула и её компоненты</div>
              </div>
              <div class="formula-badge">интерактивная формула</div>
            </div>

            <div id="legacyFormulaMount" class="legacy-formula-mount">
              ${renderMcr2026Math(currentConfig)}
            </div>

            <div class="formula-hint">
              Нажмите на коэффициент или обозначение в формуле — пояснение и связанные настройки откроются ниже.
            </div>
            <div id="formulaInspector" class="formula-inspector"></div>
          </section>

          <details class="reference-card">
            <summary>
              <span>Справочники MCR-2026 — посмотреть и поиграть</span>
              <span class="summary-note">канон + экспериментальные копии</span>
            </summary>
            <div class="reference-body">
              <div class="tabs" id="tabs"></div>
              <div id="referencePanel"></div>
            </div>
          </details>

          <section class="results-card">
            <div class="results-head">
              <div>
                <h2>Рейтинговая таблица</h2>
                <div class="reference-labels">
                  <span>Текущая: <strong>MCR-2026</strong></span>
                  <span>Эталон: <strong>MCR-2026 default</strong></span>
                </div>
              </div>
              <div id="metrics" class="metrics-strip"></div>
            </div>

            <div class="ranking-toolbar">
              <label class="ranking-search">
                <span>Поиск</span>
                <input id="rankingSearch" type="search" placeholder="Игрок, ID, уровень…" value="${esc(rankingSearch)}">
              </label>
              <div class="ranking-toolbar-actions">
                <span id="rankingVisibleCount" class="micro"></span>
                <button id="exportRankingCsv" class="download-button" type="button">↓ CSV</button>
              </div>
            </div>

            <div id="deltaLeaders" class="delta-leaders"></div>
            <div id="ranking"></div>
          </section>
        </main>
      </div>
      </div>

      <section id="historyWorkspace" class="workspace-panel history-workspace">
        <section class="history-card">
          <div class="history-header">
            <div>
              <div class="eyebrow">Последовательная симуляция</div>
              <div class="formula-caption">
                Каждый шаг — состояние рейтинга непосредственно после очередного турнира.
              </div>
            </div>
            <label class="history-mode">
              Начальное состояние
              <select id="historyInitialMode">
                <option value="clean" ${historyInitialMode === "clean" ? "selected" : ""}>
                  Чистый старт
                </option>
                <option value="imported" ${historyInitialMode === "imported" ? "selected" : ""}>
                  Игроки + импортированный EU
                </option>
              </select>
            </label>
          </div>

          <div id="historySummary" class="history-summary"></div>

          <div class="timeline-control">
            <input id="historySlider" type="range" min="0" max="0" step="1" value="0">
            <div id="historyTicks" class="history-ticks"></div>
          </div>
        </section>

        <section class="history-card">
          <div class="history-player-toolbar">
            <div>
              <strong>Движение игрока</strong>
              <span class="micro">экспериментальная MCR-2026 против MCR-2026 default</span>
            </div>
            <select id="historyPlayerSelect"></select>
          </div>
          <div id="historyPlayerChart"></div>
        </section>

        <section id="historySnapshotPanel" class="history-card"></section>
      </section>
    </div>`;

  byId("dataLabel").textContent = dataLabel;

  bindNumericControls();
  bindFormulaTokens();

  byId<HTMLInputElement>("evaluationDate").addEventListener("change", recalc);
  byId<HTMLSelectElement>("doubleStrikeMode").addEventListener("change", (e) => {
    currentConfig.doubleStrikeMode = (e.currentTarget as HTMLSelectElement).value as Mcr2026Config["doubleStrikeMode"];
    recalc();
    if (activeFormulaToken === "DoubleStrike") renderFormulaInspector();
  });
  byId<HTMLSelectElement>("substituteEuPolicy").addEventListener("change", (e) => {
    currentConfig.substituteEuPolicy = (e.currentTarget as HTMLSelectElement).value as Mcr2026Config["substituteEuPolicy"];
    recalc();
  });
  byId<HTMLInputElement>("capKyuPromotionAtFirstDan").addEventListener("change", (e) => {
    currentConfig.capKyuPromotionAtFirstDan = (e.currentTarget as HTMLInputElement).checked;
    recalc();
  });

  byId("resetConfig").addEventListener("click", () => {
    currentConfig = defaultMcr2026Config();
    useKtExperiment = false;
    useVtExperiment = false;
    ktExperiment = { ...KT_PARTICIPANTS };
    vtExperiment = MCR2026_AGE_WEIGHTS.map((x) => ({ ...x }));
    activeFormulaToken = null;
    renderShell();
    setupTabs();
    recalc();
  });

  byId("loadFiles").addEventListener("click", loadFiles);
  byId("loadBuiltin").addEventListener("click", loadBuiltin);

  byId<HTMLInputElement>("rankingSearch").addEventListener("input", (e) => {
    rankingSearch = (e.currentTarget as HTMLInputElement).value;
    renderOutput();
  });

  byId("exportRankingCsv").addEventListener("click", exportRankingCsv);

  byId("workspaceLab").addEventListener("click", () => setWorkspace("lab"));
  byId("workspaceHistory").addEventListener("click", () => setWorkspace("history"));

  byId("supportButton").addEventListener("click", () => {
    const popover = byId<HTMLDivElement>("supportPopover");
    popover.hidden = !popover.hidden;
  });

  byId("copySupportNumber").addEventListener("click", async () => {
    const value = "+7 967 087 1525";
    try {
      await navigator.clipboard.writeText(value);
      byId("supportCopyStatus").textContent = "Номер скопирован";
    } catch {
      byId("supportCopyStatus").textContent = value;
    }
  });

  byId<HTMLSelectElement>("historyInitialMode").addEventListener("change", (e) => {
    historyInitialMode = (e.currentTarget as HTMLSelectElement).value as InitialStateMode;
    historyDirty = true;
    historySnapshotIndex = 0;
    renderHistoryWorkspace();
  });

  byId<HTMLInputElement>("historySlider").addEventListener("input", (e) => {
    historySnapshotIndex = Number((e.currentTarget as HTMLInputElement).value);
    historyExpandedPlayerId = null;
    renderHistorySnapshot();
  });

  byId<HTMLSelectElement>("historyPlayerSelect").addEventListener("change", (e) => {
    historyPlayerId = (e.currentTarget as HTMLSelectElement).value || null;
    renderHistoryPlayerChart();
  });

  setupTabs();
  renderFormulaInspector();
}

function bindFormulaTokens(): void {
  document.querySelectorAll<HTMLElement>("[data-formula-token]").forEach((element) => {
    element.addEventListener("click", () => {
      const token = element.dataset.formulaToken!;
      activeFormulaToken = activeFormulaToken === token ? null : token;

      document
        .querySelectorAll<HTMLElement>("[data-formula-token]")
        .forEach((el) => el.classList.remove("selected"));

      if (activeFormulaToken) {
        document
          .querySelectorAll<HTMLElement>(`[data-formula-token="${activeFormulaToken}"]`)
          .forEach((el) => el.classList.add("selected"));
      }

      renderFormulaInspector();
    });
  });
}

function renderFormulaMath(): void {
  const mount = document.querySelector<HTMLDivElement>("#legacyFormulaMount");
  if (!mount) return;

  mount.innerHTML = renderMcr2026Math(currentConfig);
  bindFormulaTokens();

  if (activeFormulaToken) {
    mount
      .querySelectorAll<HTMLElement>(`[data-formula-token="${activeFormulaToken}"]`)
      .forEach((el) => el.classList.add("selected"));
  }
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

function renderFormulaInspector(): void {
  const panel = document.querySelector<HTMLDivElement>("#formulaInspector");
  if (!panel) return;

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

function renderOutput(): void {
  if (!current || !reference) return;

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
    deltaMiniTable("Наибольший рост", positive, "positive")
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


function setWorkspace(workspace: "lab" | "history"): void {
  activeWorkspace = workspace;
  const lab = byId("labWorkspace");
  const history = byId("historyWorkspace");
  const labButton = byId("workspaceLab");
  const historyButton = byId("workspaceHistory");

  lab.classList.toggle("active", workspace === "lab");
  history.classList.toggle("active", workspace === "history");
  labButton.classList.toggle("active", workspace === "lab");
  historyButton.classList.toggle("active", workspace === "history");

  if (workspace === "history") renderHistoryWorkspace();
}

function historyOverrides(): TableOverrides {
  const overrides: TableOverrides = {};
  if (useKtExperiment) overrides.ktParticipants = ktExperiment;
  if (useVtExperiment) overrides.ageWeights = vtExperiment;
  return overrides;
}

function ensureHistorySnapshots(): void {
  if (!historyDirty) return;

  historySnapshots = simulateMcr2026History(
    players,
    results,
    currentConfig,
    historyOverrides(),
    historyInitialMode,
  );
  historyReferenceSnapshots = simulateMcr2026History(
    players,
    results,
    defaultMcr2026Config(),
    {},
    historyInitialMode,
  );

  historyDirty = false;

  if (!historySnapshots.length) {
    historySnapshotIndex = 0;
    historyPlayerId = null;
    return;
  }

  historySnapshotIndex = Math.min(historySnapshotIndex, historySnapshots.length - 1);

  const latest = historySnapshots[historySnapshots.length - 1];
  if (
    !historyPlayerId
    || !latest.result.ranking.some((row) => row.playerId === historyPlayerId)
  ) {
    historyPlayerId = latest.result.ranking[0]?.playerId ?? null;
  }
}

function renderHistoryWorkspace(): void {
  ensureHistorySnapshots();

  const summary = byId("historySummary");
  const slider = byId<HTMLInputElement>("historySlider");
  const ticks = byId("historyTicks");
  const select = byId<HTMLSelectElement>("historyPlayerSelect");

  if (!historySnapshots.length) {
    summary.innerHTML = `<div class="notice">Нет турниров для построения временной шкалы.</div>`;
    ticks.innerHTML = "";
    select.innerHTML = "";
    byId("historyPlayerChart").innerHTML = "";
    byId("historySnapshotPanel").innerHTML = "";
    slider.min = "0";
    slider.max = "0";
    slider.value = "0";
    return;
  }

  const first = historySnapshots[0].event;
  const last = historySnapshots[historySnapshots.length - 1].event;

  summary.innerHTML = `
    <div class="history-stat"><span>Турниров</span><strong>${historySnapshots.length}</strong></div>
    <div class="history-stat"><span>Период</span><strong>${esc(first.tournamentDate)} → ${esc(last.tournamentDate)}</strong></div>
    <div class="history-stat"><span>Старт</span><strong>${historyInitialMode === "clean" ? "чистый" : "импортированный EU"}</strong></div>
    <div class="history-stat"><span>Методы</span><strong>MCR-2026 exp. / default</strong></div>
  `;

  slider.min = "0";
  slider.max = String(historySnapshots.length - 1);
  slider.value = String(historySnapshotIndex);

  ticks.innerHTML = historySnapshots.map((snapshot, i) => `
    <button
      type="button"
      class="timeline-tick ${i === historySnapshotIndex ? "active" : ""}"
      data-history-index="${i}"
      title="${esc(snapshot.event.tournamentDate)} · ${esc(snapshot.event.tournamentName)}"
      aria-label="${esc(snapshot.event.tournamentName)}"
    >
      <span></span>
    </button>
  `).join("");

  ticks.querySelectorAll<HTMLButtonElement>("[data-history-index]").forEach((button) => {
    button.addEventListener("click", () => {
      historySnapshotIndex = Number(button.dataset.historyIndex);
      historyExpandedPlayerId = null;
      slider.value = String(historySnapshotIndex);
      renderHistoryWorkspace();
    });
  });

  const latestPlayers = historySnapshots[historySnapshots.length - 1].result.ranking;
  select.innerHTML = latestPlayers.map((row) =>
    `<option value="${esc(row.playerId)}" ${row.playerId === historyPlayerId ? "selected" : ""}>`
    + `${esc(row.playerName)} · #${row.rank}</option>`
  ).join("");

  renderHistoryPlayerChart();
  renderHistorySnapshot();
}

function historySeriesForPlayer(
  snapshots: RatingSnapshot[],
  playerId: string,
): { index: number; rank: number; rating: number; date: string }[] {
  const points: { index: number; rank: number; rating: number; date: string }[] = [];
  snapshots.forEach((snapshot, index) => {
    const row = snapshot.result.ranking.find((x) => x.playerId === playerId);
    if (row) {
      points.push({
        index,
        rank: row.rank,
        rating: row.rating,
        date: snapshot.event.tournamentDate,
      });
    }
  });
  return points;
}

function svgPolyline(
  series: { index: number; rank: number }[],
  maxIndex: number,
  maxRank: number,
  width: number,
  height: number,
  padX: number,
  padY: number,
): string {
  if (!series.length) return "";
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  return series.map((p) => {
    const x = padX + (maxIndex > 0 ? (p.index / maxIndex) * innerW : innerW / 2);
    const y = padY + (maxRank > 1 ? ((p.rank - 1) / (maxRank - 1)) * innerH : innerH / 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function renderHistoryPlayerChart(): void {
  const host = byId("historyPlayerChart");
  if (!historyPlayerId || !historySnapshots.length) {
    host.innerHTML = `<div class="micro">Выберите игрока.</div>`;
    return;
  }

  const exp = historySeriesForPlayer(historySnapshots, historyPlayerId);
  const ref = historySeriesForPlayer(historyReferenceSnapshots, historyPlayerId);
  const latest = historySnapshots[historySnapshots.length - 1].result.ranking
    .find((x) => x.playerId === historyPlayerId);
  const name = latest?.playerName ?? historyPlayerId;

  const maxIndex = Math.max(1, historySnapshots.length - 1);
  const maxRank = Math.max(
    2,
    ...exp.map((x) => x.rank),
    ...ref.map((x) => x.rank),
  );

  const width = 1000;
  const height = 220;
  const padX = 46;
  const padY = 22;
  const expPoints = svgPolyline(exp, maxIndex, maxRank, width, height, padX, padY);
  const refPoints = svgPolyline(ref, maxIndex, maxRank, width, height, padX, padY);
  const selectedX = padX
    + (historySnapshotIndex / maxIndex) * (width - padX * 2);

  const selectedExp = historySnapshots[historySnapshotIndex]?.result.ranking
    .find((x) => x.playerId === historyPlayerId);
  const selectedRef = historyReferenceSnapshots[historySnapshotIndex]?.result.ranking
    .find((x) => x.playerId === historyPlayerId);

  host.innerHTML = `
    <div class="chart-head">
      <strong>${esc(name)}</strong>
      <div class="chart-legend">
        <span><i class="legend-line experimental"></i> экспериментальная</span>
        <span><i class="legend-line reference"></i> MCR-2026 default</span>
      </div>
    </div>
    <svg class="history-chart" viewBox="0 0 ${width} ${height}" role="img"
      aria-label="Движение места игрока во времени">
      <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}" class="chart-axis"/>
      <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" class="chart-axis"/>
      <text x="8" y="${padY + 4}" class="chart-label">#1</text>
      <text x="8" y="${height - padY + 4}" class="chart-label">#${maxRank}</text>
      <line x1="${selectedX}" y1="${padY}" x2="${selectedX}" y2="${height - padY}" class="chart-cursor"/>
      ${refPoints ? `<polyline points="${refPoints}" class="chart-series reference"/>` : ""}
      ${expPoints ? `<polyline points="${expPoints}" class="chart-series experimental"/>` : ""}
    </svg>
    <div class="chart-selected">
      <span>Точка ${historySnapshotIndex + 1}/${historySnapshots.length}</span>
      <span>Эксп.: <strong>${selectedExp ? `#${selectedExp.rank} · ${fmt(selectedExp.rating)}` : "—"}</strong></span>
      <span>Default: <strong>${selectedRef ? `#${selectedRef.rank} · ${fmt(selectedRef.rating)}` : "—"}</strong></span>
    </div>
  `;
}

function renderHistorySnapshot(): void {
  if (!historySnapshots.length) return;

  const snapshot = historySnapshots[historySnapshotIndex];
  const refSnapshot = historyReferenceSnapshots[historySnapshotIndex];
  const previous = historySnapshotIndex > 0
    ? historySnapshots[historySnapshotIndex - 1]
    : null;

  const previousById = new Map(
    (previous?.result.ranking ?? []).map((row) => [row.playerId, row]),
  );
  const refById = new Map(
    (refSnapshot?.result.ranking ?? []).map((row) => [row.playerId, row]),
  );

  const movers = snapshot.result.ranking
    .map((row) => {
      const before = previousById.get(row.playerId);
      const ref = refById.get(row.playerId);
      return {
        ...row,
        movement: before ? before.rank - row.rank : 0,
        previousRank: before?.rank ?? null,
        refRank: ref?.rank ?? null,
        refRating: ref?.rating ?? Number.NaN,
      };
    })
    .sort((a, b) => Math.abs(b.movement) - Math.abs(a.movement) || a.rank - b.rank);

  const details = snapshot.result.tournamentRows
    .filter((row) => row.tournamentId === snapshot.event.tournamentId
      && row.tournamentDate === snapshot.event.tournamentDate);
  const kt = details[0]?.kt;
  const meanEu = details[0]?.meanEuFinal;

  byId<HTMLInputElement>("historySlider").value = String(historySnapshotIndex);
  document.querySelectorAll(".timeline-tick").forEach((el, i) =>
    el.classList.toggle("active", i === historySnapshotIndex)
  );

  byId("historySnapshotPanel").innerHTML = `
    <div class="snapshot-head">
      <div>
        <div class="snapshot-step">Шаг ${historySnapshotIndex + 1} из ${historySnapshots.length}</div>
        <h2>${esc(snapshot.event.tournamentName)}</h2>
        <div class="reference-labels">
          <span>${esc(snapshot.event.tournamentDate)}</span>
          <span>${snapshot.event.participants} игроков</span>
          <span>${snapshot.event.sessions} сессий</span>
          <span>KT: <strong>${kt === undefined ? "—" : fmt(kt)}</strong></span>
          <span>ср. EU: <strong>${meanEu === undefined ? "—" : fmt(meanEu, 0)}</strong></span>
        </div>
      </div>
    </div>

    <div class="snapshot-grid">
      <div>
        <div class="snapshot-subtitle">Наибольшие движения после турнира</div>
        <div class="table-wrap snapshot-movers-wrap">
          <table class="snapshot-table">
            <thead><tr><th>Игрок</th><th>До</th><th>После</th><th>Δ место</th><th>Rating</th></tr></thead>
            <tbody>
              ${movers.slice(0, 10).map((row) => `<tr>
                <td>${esc(row.playerName)}</td>
                <td>${row.previousRank ? `#${row.previousRank}` : "new"}</td>
                <td>#${row.rank}</td>
                <td class="${row.movement > 0 ? "pos" : row.movement < 0 ? "neg" : ""}">
                  ${row.movement > 0 ? "+" : ""}${row.movement}
                </td>
                <td>${fmt(row.rating)}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="snapshot-subtitle">Рейтинг после этого шага</div>
        <div class="table-wrap snapshot-ranking-wrap">
          <table class="ranking-table snapshot-ranking-table">
            <thead><tr>
              <th>#</th><th class="player-col">Игрок</th><th>Уровень</th><th>EU</th><th>Турниров</th><th>T5</th>
              <th>Rating</th><th>Эталон</th><th>Δ Rating</th><th>Δ место</th>
            </tr></thead>
            <tbody>
              ${snapshot.result.ranking.map((row) => {
                const ref = refById.get(row.playerId);
                const deltaRating = ref ? row.rating - ref.rating : Number.NaN;
                const deltaRank = ref ? ref.rank - row.rank : 0;
                const expanded = historyExpandedPlayerId === row.playerId;
                return `
                  <tr class="${expanded ? "expanded-player-row" : ""}">
                    <td>${row.rank}</td>
                    <td class="player-name-cell">
                      <button class="player-link history-player-link"
                        data-history-player-id="${esc(row.playerId)}"
                        type="button" title="${esc(row.playerName)}">
                        <span>${esc(row.playerName)}</span>
                        <span class="player-expand-icon">${expanded ? "▾" : "›"}</span>
                      </button>
                    </td>
                    <td>${esc(row.level)}</td>
                    <td>${row.currentEu}</td>
                    <td>${row.tournamentsCount}</td>
                    <td>${fmt(row.t5, 1)}</td>
                    <td class="emph">${fmt(row.rating)}</td>
                    <td>${ref ? fmt(ref.rating) : "—"}</td>
                    <td class="${deltaRating > 0 ? "pos" : deltaRating < 0 ? "neg" : ""}">
                      ${Number.isFinite(deltaRating) ? `${deltaRating >= 0 ? "+" : ""}${fmt(deltaRating)}` : "—"}
                    </td>
                    <td class="${deltaRank > 0 ? "pos" : deltaRank < 0 ? "neg" : ""}">
                      ${ref ? `${deltaRank >= 0 ? "+" : ""}${deltaRank}` : "—"}
                    </td>
                  </tr>
                  ${expanded ? `
                    <tr class="player-detail-row" data-history-expanded-player="${esc(row.playerId)}">
                      <td colspan="10">${playerDetailHtml(row.playerId, snapshot.result, currentConfig.topN)}</td>
                    </tr>
                  ` : ""}
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  byId("historySnapshotPanel")
    .querySelectorAll<HTMLButtonElement>("[data-history-player-id]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const playerId = button.dataset.historyPlayerId!;
        historyExpandedPlayerId = historyExpandedPlayerId === playerId ? null : playerId;
        renderHistorySnapshot();

        if (historyExpandedPlayerId) {
          requestAnimationFrame(() => {
            document
              .querySelector(`[data-history-expanded-player="${CSS.escape(historyExpandedPlayerId!)}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        }
      });
    });

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
    dataLabel = "встроенный demo dataset";
    byId("dataLabel").textContent = dataLabel;
    recalc();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), false);
  }
}

renderShell();
loadBuiltin();
