import "./styles.css";
import { LegacyEngine, defaultLegacyConfig } from "./engine/legacy";
import { KT_PARTICIPANTS, LEGACY_AGE_WEIGHTS, LEGACY_LEVELS, LEGACY_DEFAULTS } from "./engine/legacyTables";
import type { CalculationResult, LegacyConfig, PlayerInput, ResultInput, TableOverrides } from "./engine/types";
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

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}
function fmt(v: number, d = 2): string { return Number.isFinite(v) ? v.toFixed(d) : "—"; }
function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function recalc(): void {
  const evaluationDate = (document.querySelector<HTMLInputElement>("#evaluationDate")?.value || todayIso());
  const overrides: TableOverrides = {};
  if (useKtExperiment) overrides.ktParticipants = ktExperiment;
  if (useVtExperiment) overrides.ageWeights = vtExperiment;
  try {
    current = new LegacyEngine(currentConfig, overrides).calculate(players, results, evaluationDate);
    reference = new LegacyEngine(defaultLegacyConfig()).calculate(players, results, evaluationDate);
    renderOutput();
    setStatus(`Рассчитано локально: ${players.length} игроков, ${results.length} результатов`, true);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), false);
  }
}

function setStatus(text: string, ok = true): void {
  const el = document.querySelector<HTMLDivElement>("#status");
  if (!el) return;
  el.className = ok ? "small good" : "small error";
  el.textContent = text;
}

function bindRange(id: string, key: keyof LegacyConfig, digits = 2): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`)!;
  const out = document.querySelector<HTMLElement>(`#${id}Value`)!;
  input.addEventListener("input", () => {
    const value = Number(input.value);
    (currentConfig[key] as number | boolean) = value;
    if (key === "euWeight") {
      currentConfig.t5Weight = Number((1 - value).toFixed(2));
      const paired = document.querySelector<HTMLInputElement>("#t5Weight")!;
      paired.value = String(currentConfig.t5Weight);
      document.querySelector("#t5WeightValue")!.textContent = currentConfig.t5Weight.toFixed(2);
    } else if (key === "t5Weight") {
      currentConfig.euWeight = Number((1 - value).toFixed(2));
      const paired = document.querySelector<HTMLInputElement>("#euWeight")!;
      paired.value = String(currentConfig.euWeight);
      document.querySelector("#euWeightValue")!.textContent = currentConfig.euWeight.toFixed(2);
    }
    out.textContent = value.toFixed(digits);
    recalc();
  });
}

function renderShell(): void {
  app.innerHTML = `
    <div class="app">
      <header>
        <div><h1>MCR Rating Lab</h1><div class="subtitle">v0.20 · TypeScript · расчёт выполняется в браузере</div></div>
        <div class="small">CSV не отправляются на сервер</div>
      </header>
      <div class="layout">
        <aside class="sidebar">
          <section class="card">
            <h3>Данные</h3>
            <div class="notice">Текущий источник: <strong id="dataLabel"></strong></div>
            <div class="row"><label>players.csv</label><input id="playersFile" type="file" accept=".csv,text/csv"></div>
            <div class="row"><label>results.csv</label><input id="resultsFile" type="file" accept=".csv,text/csv"></div>
            <button id="loadFiles" class="primary">Загрузить CSV локально</button>
            <button id="loadBuiltin">Вернуть встроенный RR dataset</button>
            <div id="status" class="small"></div>
          </section>
          <section class="card">
            <h3>Legacy</h3>
            <div class="row"><label>Дата выпуска рейтинга</label><input id="evaluationDate" type="date" value="${todayIso()}"></div>
            ${slider("euWeight", "Вес EU", 0, 1, .01, currentConfig.euWeight)}
            ${slider("t5Weight", "Вес T5", 0, 1, .01, currentConfig.t5Weight)}
            ${slider("sessionCoef", "Коэффициент сессии", 0, .5, .01, currentConfig.sessionCoef)}
            ${slider("playerCountScale", "Масштаб KT участников", 0, 2, .05, currentConfig.playerCountScale)}
            ${slider("euComponentScale", "Масштаб KT_EU", 0, 2, .05, currentConfig.euComponentScale)}
            ${slider("worldEuropeBonus", "Бонус ЧЕ/ЧМ", 0, 2, .05, currentConfig.worldEuropeBonus)}
            ${slider("decayPerQuarter", "Снижение VT / квартал", 0, .25, .01, currentConfig.decayPerQuarter)}
            <div class="row-inline"><input id="doubleStrike" type="checkbox" ${currentConfig.doubleStrike ? "checked" : ""}><label for="doubleStrike">Double Strike</label></div>
            <button id="resetConfig">Сбросить параметры</button>
          </section>
        </aside>
        <main class="main">
          <section class="card">
            <h2>Формула Legacy</h2>
            <div class="formula">Rating = <span id="formulaEuWeight">0.25</span>·EU + <span id="formulaT5Weight">0.75</span>·T5</div>
            <div class="formula">T5 = Σ top-${currentConfig.topN}(NR · KT · VT) / ${currentConfig.topN}</div>
            <div class="formula">KT = ЧС·k<sub>сессии</sub> + KT<sub>ЧУТ</sub> + ⌊EŪ/1000⌋<sub>0.05</sub> + KT<sub>W</sub></div>
            <div class="small">TypeScript engine портирован с Python Legacy v0.10. TrueSkill будет переноситься отдельным шагом после сверки Legacy.</div>
          </section>
          <section class="card">
            <h2>Справочники Legacy</h2>
            <div class="tabs" id="tabs"></div>
            <div id="referencePanel"></div>
          </section>
          <section class="card">
            <h2>Изменения относительно Legacy default</h2>
            <div id="metrics" class="grid-metrics"></div>
          </section>
          <section class="card">
            <h2>Рейтинговая таблица</h2>
            <div id="ranking"></div>
          </section>
        </main>
      </div>
    </div>`;

  document.querySelector("#dataLabel")!.textContent = dataLabel;
  bindRange("euWeight", "euWeight"); bindRange("t5Weight", "t5Weight");
  bindRange("sessionCoef", "sessionCoef"); bindRange("playerCountScale", "playerCountScale");
  bindRange("euComponentScale", "euComponentScale"); bindRange("worldEuropeBonus", "worldEuropeBonus");
  bindRange("decayPerQuarter", "decayPerQuarter");

  document.querySelector<HTMLInputElement>("#evaluationDate")!.addEventListener("change", recalc);
  document.querySelector<HTMLInputElement>("#doubleStrike")!.addEventListener("change", (e) => {
    currentConfig.doubleStrike = (e.currentTarget as HTMLInputElement).checked; recalc();
  });
  document.querySelector("#resetConfig")!.addEventListener("click", () => {
    currentConfig = defaultLegacyConfig(); useKtExperiment = false; useVtExperiment = false;
    ktExperiment = { ...KT_PARTICIPANTS }; vtExperiment = LEGACY_AGE_WEIGHTS.map((x) => ({ ...x }));
    renderShell(); setupTabs(); recalc();
  });
  document.querySelector("#loadFiles")!.addEventListener("click", loadFiles);
  document.querySelector("#loadBuiltin")!.addEventListener("click", loadBuiltin);
  setupTabs();
}

function slider(id: string, label: string, min: number, max: number, step: number, value: number): string {
  return `<div class="row"><label>${esc(label)}: <span id="${id}Value" class="value">${value.toFixed(2)}</span></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}

const tabNames = ["Кю/даны ↔ EU", "KT по участникам", "VT / устаревание", "Константы"];
function setupTabs(): void {
  const tabs = document.querySelector<HTMLDivElement>("#tabs")!;
  tabs.innerHTML = tabNames.map((x, i) => `<button data-tab="${i}" class="${i === 0 ? "active" : ""}">${x}</button>`).join("");
  tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    tabs.querySelectorAll("button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); renderReference(Number((b as HTMLButtonElement).dataset.tab));
  }));
  renderReference(0);
}

function renderReference(tab: number): void {
  const panel = document.querySelector<HTMLDivElement>("#referencePanel")!;
  if (tab === 0) {
    panel.innerHTML = table(["EU", "Уровень", "Тип"], LEGACY_LEVELS.map((x) => [x.eu, x.label, x.kind]));
  } else if (tab === 1) {
    panel.innerHTML = `<div class="row-inline"><input type="checkbox" id="useKt" ${useKtExperiment ? "checked" : ""}><label for="useKt">Использовать экспериментальную копию</label><button id="resetKt">Сбросить</button></div>
      <div class="table-wrap"><table class="editor-table"><thead><tr><th>Участники</th><th>Legacy</th><th>Эксперимент</th></tr></thead><tbody>
      ${Object.entries(KT_PARTICIPANTS).map(([n, v]) => `<tr><td>${n}</td><td>${Number(v).toFixed(2)}</td><td><input data-kt="${n}" type="number" step="0.05" value="${ktExperiment[Number(n)].toFixed(2)}"></td></tr>`).join("")}
      </tbody></table></div>`;
    panel.querySelector<HTMLInputElement>("#useKt")!.addEventListener("change", (e) => { useKtExperiment = (e.currentTarget as HTMLInputElement).checked; recalc(); });
    panel.querySelector("#resetKt")!.addEventListener("click", () => { ktExperiment = { ...KT_PARTICIPANTS }; useKtExperiment = false; renderReference(1); recalc(); });
    panel.querySelectorAll<HTMLInputElement>("[data-kt]").forEach((el) => el.addEventListener("change", () => { ktExperiment[Number(el.dataset.kt)] = Number(el.value); recalc(); }));
  } else if (tab === 2) {
    panel.innerHTML = `<div class="row-inline"><input type="checkbox" id="useVt" ${useVtExperiment ? "checked" : ""}><label for="useVt">Использовать экспериментальную таблицу</label><button id="resetVt">Сбросить</button></div>
      <div class="table-wrap"><table class="editor-table"><thead><tr><th>Период</th><th>Legacy</th><th>Эксперимент</th></tr></thead><tbody>
      ${LEGACY_AGE_WEIGHTS.map((x, i) => `<tr><td>${x.minMonths}–${x.maxMonths ?? "∞"} мес.</td><td>${x.weight.toFixed(2)}</td><td><input data-vt="${i}" type="number" min="0" max="2" step="0.01" value="${vtExperiment[i].weight.toFixed(2)}"></td></tr>`).join("")}
      </tbody></table></div>`;
    panel.querySelector<HTMLInputElement>("#useVt")!.addEventListener("change", (e) => { useVtExperiment = (e.currentTarget as HTMLInputElement).checked; recalc(); });
    panel.querySelector("#resetVt")!.addEventListener("click", () => { vtExperiment = LEGACY_AGE_WEIGHTS.map((x) => ({ ...x })); useVtExperiment = false; renderReference(2); recalc(); });
    panel.querySelectorAll<HTMLInputElement>("[data-vt]").forEach((el) => el.addEventListener("change", () => { vtExperiment[Number(el.dataset.vt)].weight = Number(el.value); recalc(); }));
  } else {
    panel.innerHTML = table(["Параметр", "Legacy"], Object.entries(LEGACY_DEFAULTS).map(([k, v]) => [k, String(v)]));
  }
}

function table(headers: string[], rows: (string | number)[][]): string {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderOutput(): void {
  if (!current || !reference) return;
  document.querySelector("#formulaEuWeight")!.textContent = currentConfig.euWeight.toFixed(2);
  document.querySelector("#formulaT5Weight")!.textContent = currentConfig.t5Weight.toFixed(2);

  const refById = new Map(reference.ranking.map((x) => [x.playerId, x]));
  const diffs = current.ranking.map((x) => {
    const ref = refById.get(x.playerId);
    return { ...x, refRating: ref?.rating ?? NaN, deltaRating: ref ? x.rating - ref.rating : NaN, deltaRank: ref ? ref.rank - x.rank : 0 };
  });
  const changed = diffs.filter((x) => x.deltaRank !== 0).length;
  const validDelta = diffs.map((x) => x.deltaRating).filter(Number.isFinite);
  const meanAbs = validDelta.length ? validDelta.reduce((s, x) => s + Math.abs(x), 0) / validDelta.length : 0;
  const maxUp = validDelta.length ? Math.max(...validDelta) : 0;
  const maxDown = validDelta.length ? Math.min(...validDelta) : 0;
  const topCurrent = new Set(current.ranking.slice(0, 10).map((x) => x.playerId));
  const topRef = new Set(reference.ranking.slice(0, 10).map((x) => x.playerId));
  const topChanged = [...topCurrent].filter((x) => !topRef.has(x)).length;

  document.querySelector("#metrics")!.innerHTML = [
    ["Изменили место", changed], ["Среднее |Δ Rating|", fmt(meanAbs)], ["Макс. рост", `+${fmt(maxUp)}`], ["Макс. падение", fmt(maxDown)], ["Изменений Top-10", topChanged],
  ].map(([k, v]) => `<div class="metric"><span class="small">${k}</span><strong>${v}</strong></div>`).join("");

  document.querySelector("#ranking")!.innerHTML = `<div class="table-wrap"><table><thead><tr><th>#</th><th>Игрок</th><th>Уровень</th><th>EU</th><th>T5</th><th>Rating</th><th>Legacy default</th><th>Δ Rating</th><th>Δ место</th><th>Турниры</th></tr></thead><tbody>
    ${diffs.map((x) => `<tr><td>${x.rank}</td><td>${esc(x.playerName)}</td><td>${esc(x.level)}</td><td>${x.currentEu}</td><td>${fmt(x.t5, 1)}</td><td>${fmt(x.rating)}</td><td>${fmt(x.refRating)}</td><td>${x.deltaRating >= 0 ? "+" : ""}${fmt(x.deltaRating)}</td><td>${x.deltaRank >= 0 ? "+" : ""}${x.deltaRank}</td><td>${x.tournamentsCount}</td></tr>`).join("")}
    </tbody></table></div>`;
}

async function loadFiles(): Promise<void> {
  const pf = document.querySelector<HTMLInputElement>("#playersFile")!.files?.[0];
  const rf = document.querySelector<HTMLInputElement>("#resultsFile")!.files?.[0];
  if (!pf || !rf) { setStatus("Нужно выбрать оба CSV", false); return; }
  try {
    const [pt, rt] = await Promise.all([pf.text(), rf.text()]);
    players = playersFromCsv(pt); results = resultsFromCsv(rt); dataLabel = `${pf.name} + ${rf.name}`;
    document.querySelector("#dataLabel")!.textContent = dataLabel; recalc();
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error), false); }
}

async function loadBuiltin(): Promise<void> {
  try {
    setStatus("Загрузка встроенного набора…", true);
    const data = await loadCsvPair("/data/players_riichi_rr.csv", "/data/results_riichi_rr.csv");
    players = data.players; results = data.results; dataLabel = "встроенный RR/offline dataset";
    document.querySelector("#dataLabel")!.textContent = dataLabel; recalc();
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error), false); }
}

renderShell();
loadBuiltin();
