
import "./styles.css";
import "katex/dist/katex.min.css";
import { renderLegacyMath } from "./ui/formulas";
import { LegacyEngine, defaultLegacyConfig } from "./engine/legacy";
import {
  KT_PARTICIPANTS,
  LEGACY_AGE_WEIGHTS,
  LEGACY_LEVELS,
  LEGACY_DEFAULTS,
} from "./engine/legacyTables";
import type {
  CalculationResult,
  LegacyConfig,
  PlayerInput,
  ResultInput,
  TableOverrides,
} from "./engine/types";
import { loadCsvPair, playersFromCsv, resultsFromCsv } from "./data/csv";

const app = document.querySelector<HTMLDivElement>("#app")!;

let players: PlayerInput[] = [];
let results: ResultInput[] = [];
let currentConfig: LegacyConfig = defaultLegacyConfig();
let ktExperiment: Record<number, number> = { ...KT_PARTICIPANTS };
let vtExperiment = LEGACY_AGE_WEIGHTS.map((x) => ({ ...x }));
let useKtExperiment = false;
let useVtExperiment = false;
let current: CalculationResult | null = null;
let reference: CalculationResult | null = null;
let dataLabel = "встроенный RR/offline dataset";
let activeFormulaToken: string | null = null;
let activeReferenceTab = 0;

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
    current = new LegacyEngine(currentConfig, overrides).calculate(players, results, evaluationDate);
    reference = new LegacyEngine(defaultLegacyConfig()).calculate(players, results, evaluationDate);
    syncAllControlValues();
    renderFormulaMath();
    renderOutput();
    setStatus(`Рассчитано локально: ${players.length} игроков, ${results.length} результатов`, true);
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
  [K in keyof LegacyConfig]: LegacyConfig[K] extends number ? K : never
}[keyof LegacyConfig];

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
  worldEuropeBonus: { key: "worldEuropeBonus", label: "Бонус ЧЕ/ЧМ", min: 0, max: 2, step: .05 },
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
          <div class="subtitle">v0.22 · TypeScript · расчёт выполняется в браузере</div>
        </div>
        <div class="privacy-pill">CSV остаются на устройстве пользователя</div>
      </header>

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
                  <button id="loadBuiltin">RR dataset</button>
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
                ${controlHtml("worldEuropeBonus", "side")}
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
              <div class="section-body">
                <label class="switch-row">
                  <input id="doubleStrike" type="checkbox" ${currentConfig.doubleStrike ? "checked" : ""}>
                  <span>Double Strike</span>
                </label>
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
              <button id="resetConfig" class="full">Сбросить Legacy к default</button>
            </div>
          </section>
        </aside>

        <main class="main">
          <section class="formula-card">
            <div class="eyebrow-row">
              <div>
                <div class="eyebrow">Legacy</div>
                <div class="formula-caption">Основная формула и её компоненты</div>
              </div>
              <div class="formula-badge">интерактивная формула</div>
            </div>

            <div id="legacyFormulaMount" class="legacy-formula-mount">
              ${renderLegacyMath(currentConfig)}
            </div>

            <div class="formula-hint">
              Нажмите на коэффициент или обозначение в формуле — пояснение и связанные настройки откроются ниже.
            </div>
            <div id="formulaInspector" class="formula-inspector"></div>
          </section>

          <details class="reference-card">
            <summary>
              <span>Справочники Legacy — посмотреть и поиграть</span>
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
                  <span>Текущая: <strong>Legacy</strong></span>
                  <span>Эталон: <strong>Legacy default</strong></span>
                </div>
              </div>
              <div id="metrics" class="metrics-strip"></div>
            </div>
            <div id="ranking"></div>
          </section>
        </main>
      </div>
    </div>`;

  byId("dataLabel").textContent = dataLabel;

  bindNumericControls();
  bindFormulaTokens();

  byId<HTMLInputElement>("evaluationDate").addEventListener("change", recalc);
  byId<HTMLInputElement>("doubleStrike").addEventListener("change", (e) => {
    currentConfig.doubleStrike = (e.currentTarget as HTMLInputElement).checked;
    recalc();
    if (activeFormulaToken === "DoubleStrike") renderFormulaInspector();
  });

  byId("resetConfig").addEventListener("click", () => {
    currentConfig = defaultLegacyConfig();
    useKtExperiment = false;
    useVtExperiment = false;
    ktExperiment = { ...KT_PARTICIPANTS };
    vtExperiment = LEGACY_AGE_WEIGHTS.map((x) => ({ ...x }));
    activeFormulaToken = null;
    renderShell();
    setupTabs();
    recalc();
  });

  byId("loadFiles").addEventListener("click", loadFiles);
  byId("loadBuiltin").addEventListener("click", loadBuiltin);

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

  mount.innerHTML = renderLegacyMath(currentConfig);
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
    text: "Сумма компонентов по числу сессий, участникам, среднему EU и статусу ЧЕ/ЧМ.",
    controls: ["sessionCoef", "playerCountScale", "euComponentScale", "worldEuropeBonus"],
  },
  KT_S: {
    title: "KT_ЧС",
    text: "Компонент коэффициента турнира по числу игровых сессий.",
    controls: ["sessionCoef"],
  },
  KT_N: {
    title: "KT_ЧУТ",
    text: "Компонент KT по числу участников. Масштаб можно менять ползунком, а саму таблицу — в справочнике.",
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
    text: "Дополнительный бонус турнирам со статусом ЧЕ/ЧМ.",
    controls: ["worldEuropeBonus"],
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
    text: "После первого обновления EU турнир пересчитывается повторно с обновлённым средним EU участников.",
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
      <label class="switch-row inspector-switch">
        <input id="formulaDoubleStrike" type="checkbox" ${currentConfig.doubleStrike ? "checked" : ""}>
        <span>Double Strike</span>
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

  const ds = panel.querySelector<HTMLInputElement>("#formulaDoubleStrike");
  if (ds) {
    ds.addEventListener("change", () => {
      currentConfig.doubleStrike = ds.checked;
      byId<HTMLInputElement>("doubleStrike").checked = ds.checked;
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
      LEGACY_LEVELS.map((x) => [x.eu, x.label, x.kind]),
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
        <thead><tr><th>Участники</th><th>Legacy</th><th>Эксперимент</th></tr></thead>
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
        <thead><tr><th>Период</th><th>Legacy</th><th>Эксперимент</th></tr></thead>
        <tbody>
        ${LEGACY_AGE_WEIGHTS.map((x, i) => `
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
      vtExperiment = LEGACY_AGE_WEIGHTS.map((x) => ({ ...x }));
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
      ["Параметр", "Legacy"],
      Object.entries(LEGACY_DEFAULTS).map(([k, v]) => [k, String(v)]),
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

function renderOutput(): void {
  if (!current || !reference) return;

  syncAllControlValues();

  const refById = new Map(reference.ranking.map((x) => [x.playerId, x]));
  const diffs = current.ranking.map((x) => {
    const ref = refById.get(x.playerId);
    return {
      ...x,
      refRating: ref?.rating ?? NaN,
      deltaRating: ref ? x.rating - ref.rating : NaN,
      deltaRank: ref ? ref.rank - x.rank : 0,
    };
  });

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
    ["Макс. рост", `+${fmt(maxUp)}`],
    ["Макс. падение", fmt(maxDown)],
  ].map(([k, v]) =>
    `<div class="metric-chip"><span>${k}</span><strong>${v}</strong></div>`
  ).join("");

  document.querySelector("#ranking")!.innerHTML = `
    <div class="table-wrap ranking-wrap">
      <table class="ranking-table">
        <thead><tr>
          <th>#</th><th>Игрок</th><th>Уровень</th><th>EU</th><th>T5</th>
          <th>Rating</th><th>Эталон</th><th>Δ Rating</th><th>Δ место</th>
        </tr></thead>
        <tbody>
          ${diffs.map((x) => `<tr>
            <td>${x.rank}</td>
            <td>${esc(x.playerName)}</td>
            <td>${esc(x.level)}</td>
            <td>${x.currentEu}</td>
            <td>${fmt(x.t5, 1)}</td>
            <td class="emph">${fmt(x.rating)}</td>
            <td>${fmt(x.refRating)}</td>
            <td class="${x.deltaRating > 0 ? "pos" : x.deltaRating < 0 ? "neg" : ""}">
              ${x.deltaRating >= 0 ? "+" : ""}${fmt(x.deltaRating)}
            </td>
            <td class="${x.deltaRank > 0 ? "pos" : x.deltaRank < 0 ? "neg" : ""}">
              ${x.deltaRank >= 0 ? "+" : ""}${x.deltaRank}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
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
      "/data/players_riichi_rr.csv",
      "/data/results_riichi_rr.csv",
    );
    players = data.players;
    results = data.results;
    dataLabel = "встроенный RR/offline dataset";
    byId("dataLabel").textContent = dataLabel;
    recalc();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), false);
  }
}

renderShell();
loadBuiltin();
