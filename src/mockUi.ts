import type { PlayerInput, ResultInput } from "./engine/types";
import {
  generateMockHistory,
  expandPlayerTemplates,
  type GeneratedMockHistory,
  type MockGenerationConfig,
  type MockPlayerTemplate,
  type MockTournamentTemplate,
  type QualificationMethod,
  type SeatingType,
  type SubstituteSkillPolicy,
  type TournamentScope,
} from "./mockGenerator";

interface MockUiHooks {
  useDataset(players: PlayerInput[], results: ResultInput[], label: string): void;
}

let playerTemplates: MockPlayerTemplate[] = [];
let tournamentTemplates: MockTournamentTemplate[] = [];
let generated: GeneratedMockHistory | null = null;
let editingPlayerId = "";
let editingTournamentId = "";
let templateCounter = 1;
let genConfig: MockGenerationConfig = {
  seed: 20261007,
  startDate: "2017-01-01",
  endDate: "2026-12-31",
  neutralAlpha: 0.25,
  basePerformanceSigma: 260,
};

function esc(v: unknown): string { return String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]!)); }
function id(prefix: string): string { return `${prefix}-${Date.now()}-${templateCounter++}`; }
function num(root: ParentNode, key: string, fallback = 0): number { const e=root.querySelector<HTMLInputElement>(`[data-mock-field="${key}"]`); const n=Number(e?.value); return Number.isFinite(n)?n:fallback; }
function str(root: ParentNode, key: string): string { return root.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-mock-field="${key}"]`)?.value?.trim() ?? ""; }
function bool(root: ParentNode, key: string): boolean { return Boolean(root.querySelector<HTMLInputElement>(`[data-mock-field="${key}"]`)?.checked); }
function pct(root: ParentNode, key: string, fallback=0): number { return Math.max(0,Math.min(1,num(root,key,fallback*100)/100)); }
function csvCell(v: unknown): string { const s=String(v??""); return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }
function download(filename:string,text:string,mime="text/csv;charset=utf-8"):void{const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}

function defaultPlayer(): MockPlayerTemplate {
  return { id:"", baseName:"Игрок", count:10, latentElo:1500, activity:.6, externalActivity:.25, consistency:.65, driftPerYear:0, activeFrom:genConfig.startDate, activeTo:"", includeInRating:true, country:"RU", addCharacteristics:true, initialEu:0, initialMarks:0, initialDanDate:"" };
}
function defaultTournament(): MockTournamentTemplate {
  return { id:"", name:"Local Open", count:1, targetPlayers:32, minPlayers:16, sessions:6, seating:"swiss", scope:"internal", isStatus:false, ratingQuota:0, qualificationMethod:"neutral", substitutes:0, substituteSkillPolicy:"pool-average", substituteFixedElo:1500, substituteMinElo:1300, substituteMaxElo:1700, frequencyPerYear:2, months:[3,9], useFixedMonths:false, skillWeight:1, randomness:1, roundToFour:true };
}

function playerFormHtml(p:MockPlayerTemplate):string{return `
  <div class="mock-form-grid" id="mockPlayerForm">
    <label class="mock-field mock-wide"><span>Основа имени</span><input data-mock-field="baseName" value="${esc(p.baseName)}"></label>
    <label class="mock-field"><span>Latent ELO</span><input data-mock-field="latentElo" type="number" min="500" max="3000" step="25" value="${p.latentElo}"></label>
    <label class="mock-field"><span>Количество ×</span><input data-mock-field="count" type="number" min="1" max="1000" step="1" value="${p.count}"></label>
    <label class="mock-field"><span>Активность, %</span><input data-mock-field="activity" type="number" min="0" max="100" step="1" value="${Math.round(p.activity*100)}"></label>
    <label class="mock-field"><span>Внешние турниры, %</span><input data-mock-field="externalActivity" type="number" min="0" max="100" step="1" value="${Math.round(p.externalActivity*100)}"></label>
    <label class="mock-field"><span>Стабильность, %</span><input data-mock-field="consistency" type="number" min="0" max="100" step="1" value="${Math.round(p.consistency*100)}"></label>
    <label class="mock-field"><span>Skill drift / год</span><input data-mock-field="driftPerYear" type="number" min="-500" max="500" step="10" value="${p.driftPerYear}"></label>
    <label class="mock-field"><span>Active from</span><input data-mock-field="activeFrom" type="date" value="${esc(p.activeFrom)}"></label>
    <label class="mock-field"><span>Active to</span><input data-mock-field="activeTo" type="date" value="${esc(p.activeTo)}"></label>
    <label class="mock-field"><span>Страна / метка</span><input data-mock-field="country" value="${esc(p.country)}"></label>
    <label class="mock-check"><input data-mock-field="includeInRating" type="checkbox" ${p.includeInRating?"checked":""}><span>Отображать во внутреннем рейтинге</span></label>
    <label class="mock-check"><input data-mock-field="addCharacteristics" type="checkbox" ${p.addCharacteristics?"checked":""}><span>Добавлять характеристики к имени</span></label>
    <details class="mock-advanced mock-wide"><summary>Начальное состояние MCR</summary><div class="mock-form-grid inner">
      <label class="mock-field"><span>initial EU</span><input data-mock-field="initialEu" type="number" step="50" value="${p.initialEu}"></label>
      <label class="mock-field"><span>initial marks</span><input data-mock-field="initialMarks" type="number" step="1" value="${p.initialMarks}"></label>
      <label class="mock-field"><span>initial dan date</span><input data-mock-field="initialDanDate" type="date" value="${esc(p.initialDanDate)}"></label>
    </div></details>
  </div>`;}

function tournamentFormHtml(t:MockTournamentTemplate):string{return `
  <div class="mock-form-grid" id="mockTournamentForm">
    <label class="mock-field mock-wide"><span>Условное название</span><input data-mock-field="name" value="${esc(t.name)}"></label>
    <label class="mock-field"><span>Размер</span><input data-mock-field="targetPlayers" type="number" min="4" max="512" step="1" value="${t.targetPlayers}"></label>
    <label class="mock-field"><span>Минимум для проведения</span><input data-mock-field="minPlayers" type="number" min="4" max="512" step="1" value="${t.minPlayers}"></label>
    <label class="mock-field"><span>Рассадка</span><select data-mock-field="seating"><option value="random" ${t.seating==="random"?"selected":""}>Random</option><option value="swiss" ${t.seating==="swiss"?"selected":""}>Swiss</option><option value="seeded" ${t.seating==="seeded"?"selected":""}>Seeded → Swiss</option></select></label>
    <label class="mock-field"><span>Туров / ханчанов</span><input data-mock-field="sessions" type="number" min="1" max="40" step="1" value="${t.sessions}"></label>
    <label class="mock-field"><span>Тип</span><select data-mock-field="scope"><option value="internal" ${t.scope==="internal"?"selected":""}>Внутренний</option><option value="external" ${t.scope==="external"?"selected":""}>External</option></select></label>
    <label class="mock-field"><span>Количество ×</span><input data-mock-field="count" type="number" min="1" max="100" step="1" value="${t.count}"></label>
    <label class="mock-check"><input data-mock-field="isStatus" type="checkbox" ${t.isStatus?"checked":""}><span>Статусный</span></label>
    <label class="mock-check"><input data-mock-field="roundToFour" type="checkbox" ${t.roundToFour?"checked":""}><span>Приводить размер к кратному 4</span></label>
    <label class="mock-field"><span>Квота из рейтинга</span><input data-mock-field="ratingQuota" type="number" min="0" max="512" step="1" value="${t.ratingQuota}"></label>
    <label class="mock-field"><span>Рейтинг для квоты</span><select data-mock-field="qualificationMethod">
      <option value="neutral" ${t.qualificationMethod==="neutral"?"selected":""}>Default: нейтральный mock-рейтинг</option>
      <option value="mcr" ${t.qualificationMethod==="mcr"?"selected":""}>MCR-2026 default</option><option value="rr" ${t.qualificationMethod==="rr"?"selected":""}>RR default</option><option value="trueskill" ${t.qualificationMethod==="trueskill"?"selected":""}>TrueSkill Tournament default</option><option value="elo-pl" ${t.qualificationMethod==="elo-pl"?"selected":""}>Elo-PL default</option>
    </select></label>
    <label class="mock-field"><span>Игроков замены</span><input data-mock-field="substitutes" type="number" min="0" max="128" step="1" value="${t.substitutes}"></label>
    <label class="mock-field"><span>Сила замен</span><select data-mock-field="substituteSkillPolicy"><option value="pool-average" ${t.substituteSkillPolicy==="pool-average"?"selected":""}>Средняя сила пула</option><option value="fixed" ${t.substituteSkillPolicy==="fixed"?"selected":""}>Фиксированный ELO</option><option value="range" ${t.substituteSkillPolicy==="range"?"selected":""}>Диапазон ELO</option></select></label>
    <label class="mock-field"><span>ELO замен (fixed)</span><input data-mock-field="substituteFixedElo" type="number" step="25" value="${t.substituteFixedElo}"></label>
    <label class="mock-field"><span>ELO замен min</span><input data-mock-field="substituteMinElo" type="number" step="25" value="${t.substituteMinElo}"></label>
    <label class="mock-field"><span>ELO замен max</span><input data-mock-field="substituteMaxElo" type="number" step="25" value="${t.substituteMaxElo}"></label>
    <label class="mock-field"><span>Раз в год</span><input data-mock-field="frequencyPerYear" type="number" min="1" max="24" step="1" value="${t.frequencyPerYear}"></label>
    <label class="mock-check"><input data-mock-field="useFixedMonths" type="checkbox" ${t.useFixedMonths?"checked":""}><span>Фиксированные месяцы</span></label>
    <label class="mock-field mock-wide"><span>Месяцы (1–12, через запятую)</span><input data-mock-field="months" value="${esc(t.months.join(","))}"></label>
    <label class="mock-field"><span>Влияние skill</span><input data-mock-field="skillWeight" type="number" min="0" max="3" step="0.05" value="${t.skillWeight}"></label>
    <label class="mock-field"><span>Турнирная случайность</span><input data-mock-field="randomness" type="number" min="0.05" max="3" step="0.05" value="${t.randomness}"></label>
  </div>`;}

function playerFromForm(root:ParentNode, existingId=""):MockPlayerTemplate{return{
  id:existingId||id("pt"),baseName:str(root,"baseName")||"Игрок",count:Math.max(1,Math.floor(num(root,"count",1))),latentElo:num(root,"latentElo",1500),activity:pct(root,"activity",.6),externalActivity:pct(root,"externalActivity",.25),consistency:pct(root,"consistency",.65),driftPerYear:num(root,"driftPerYear",0),activeFrom:str(root,"activeFrom")||genConfig.startDate,activeTo:str(root,"activeTo"),includeInRating:bool(root,"includeInRating"),country:str(root,"country")||"RU",addCharacteristics:bool(root,"addCharacteristics"),initialEu:num(root,"initialEu",0),initialMarks:num(root,"initialMarks",0),initialDanDate:str(root,"initialDanDate")};}
function tournamentFromForm(root:ParentNode,existingId=""):MockTournamentTemplate{const months=str(root,"months").split(/[,;\s]+/).map(Number).filter(x=>Number.isFinite(x)&&x>=1&&x<=12);return{id:existingId||id("tt"),name:str(root,"name")||"Tournament",count:Math.max(1,Math.floor(num(root,"count",1))),targetPlayers:Math.max(4,Math.floor(num(root,"targetPlayers",32))),minPlayers:Math.max(4,Math.floor(num(root,"minPlayers",16))),sessions:Math.max(1,Math.floor(num(root,"sessions",6))),seating:str(root,"seating") as SeatingType,scope:str(root,"scope") as TournamentScope,isStatus:bool(root,"isStatus"),ratingQuota:Math.max(0,Math.floor(num(root,"ratingQuota",0))),qualificationMethod:str(root,"qualificationMethod") as QualificationMethod,substitutes:Math.max(0,Math.floor(num(root,"substitutes",0))),substituteSkillPolicy:str(root,"substituteSkillPolicy") as SubstituteSkillPolicy,substituteFixedElo:num(root,"substituteFixedElo",1500),substituteMinElo:num(root,"substituteMinElo",1300),substituteMaxElo:num(root,"substituteMaxElo",1700),frequencyPerYear:Math.max(1,Math.floor(num(root,"frequencyPerYear",2))),months:months.length?months:[3,9],useFixedMonths:bool(root,"useFixedMonths"),skillWeight:num(root,"skillWeight",1),randomness:num(root,"randomness",1),roundToFour:bool(root,"roundToFour")};}

function playersCsv(rows:PlayerInput[]):string{const cols=["player_id","player_name","initial_eu","initial_marks","initial_dan_date","include_in_rating","latent_elo","activity","external_activity","consistency","skill_drift_per_year","active_from","active_to","country"];return [cols.join(","),...rows.map(r=>cols.map(c=>csvCell((r as any)[c])).join(","))].join("\r\n");}
function resultsCsv(rows:ResultInput[]):string{const cols=["tournament_id","tournament_name","tournament_date","tournament_order","player_id","place","participants","sessions","is_status_tournament","is_substitute","tournament_type"];return [cols.join(","),...rows.map(r=>cols.map(c=>csvCell((r as any)[c])).join(","))].join("\r\n");}

function renderTables(root:HTMLElement):void{
  const p=root.querySelector<HTMLDivElement>("#mockPlayersTable"); if(p)p.innerHTML=`<div class="mock-table-head"><strong>Пул игроков</strong><span>${playerTemplates.reduce((s,x)=>s+x.count,0)} игроков · ${playerTemplates.length} шаблонов <button id="mockDownloadPlayerPool" class="download-button" type="button">↓ players.csv</button></span></div><div class="table-wrap"><table class="editor-table"><thead><tr><th>Имя</th><th>×</th><th>ELO</th><th>Актив.</th><th>Стаб.</th><th>Drift</th><th>Рейтинг</th><th></th></tr></thead><tbody>${playerTemplates.map(x=>`<tr><td>${esc(x.baseName)}</td><td>${x.count}</td><td>${x.latentElo}</td><td>${Math.round(x.activity*100)}%</td><td>${Math.round(x.consistency*100)}%</td><td>${x.driftPerYear>=0?"+":""}${x.driftPerYear}</td><td>${x.includeInRating?"✓":"—"}</td><td class="mock-actions"><button data-edit-player="${x.id}">✎</button><button data-copy-player="${x.id}">⧉</button><button data-delete-player="${x.id}">×</button></td></tr>`).join("")||`<tr><td colspan="8" class="micro">Добавьте хотя бы один шаблон игроков.</td></tr>`}</tbody></table></div>`;
  const t=root.querySelector<HTMLDivElement>("#mockTournamentsTable"); if(t)t.innerHTML=`<div class="mock-table-head"><strong>Стек турниров</strong><span>${tournamentTemplates.length} шаблонов · ~${tournamentTemplates.reduce((s,x)=>s+x.count*x.frequencyPerYear,0)} событий/год</span></div><div class="table-wrap"><table class="editor-table"><thead><tr><th>Название</th><th>×</th><th>N</th><th>Туры</th><th>Рассадка</th><th>Тип</th><th>Статус / квота</th><th>Частота</th><th></th></tr></thead><tbody>${tournamentTemplates.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count}</td><td>${x.targetPlayers}</td><td>${x.sessions}</td><td>${esc(x.seating)}</td><td>${x.scope==="external"?"external":"internal"}</td><td>${x.isStatus?`✓ / ${x.ratingQuota}`:"—"}</td><td>${x.frequencyPerYear}/год</td><td class="mock-actions"><button data-edit-tournament="${x.id}">✎</button><button data-copy-tournament="${x.id}">⧉</button><button data-delete-tournament="${x.id}">×</button></td></tr>`).join("")||`<tr><td colspan="9" class="micro">Добавьте хотя бы один шаблон турнира.</td></tr>`}</tbody></table></div>`;
}

function renderGenerated(root:HTMLElement):void{const host=root.querySelector<HTMLDivElement>("#mockGenerated");if(!host)return;if(!generated){host.innerHTML=`<div class="notice">После генерации здесь появится сводка и экспорт <code>players.csv</code>, <code>results.csv</code> и manifest.</div>`;return;}const m=generated.manifest;host.innerHTML=`<div class="mock-summary-grid"><div><span>Игроков</span><strong>${m.permanentPlayers}</strong></div><div><span>Одноразовых замен</span><strong>${m.substitutePlayers}</strong></div><div><span>Турниров</span><strong>${m.tournamentsGenerated}</strong></div><div><span>Отменено</span><strong>${m.tournamentsCancelled}</strong></div><div><span>Строк results</span><strong>${m.resultRows}</strong></div><div><span>Seed</span><strong>${m.seed}</strong></div></div><div class="mock-export-row"><button id="mockUseDataset" class="primary-button">Use in Rating Lab</button><button id="mockDownloadPlayers" class="download-button">↓ players.csv</button><button id="mockDownloadResults" class="download-button">↓ results.csv</button><button id="mockDownloadManifest" class="download-button">↓ manifest.json</button></div>`;}

function bind(root:HTMLElement,hooks:MockUiHooks):void{
  root.querySelector<HTMLButtonElement>("#mockSavePlayer")!.onclick=()=>{const form=root.querySelector("#mockPlayerForm")!;const item=playerFromForm(form,editingPlayerId);if(editingPlayerId)playerTemplates=playerTemplates.map(x=>x.id===editingPlayerId?item:x);else playerTemplates.push(item);editingPlayerId="";generated=null;renderMockWorkspace(root,hooks);};
  root.querySelector<HTMLButtonElement>("#mockResetPlayer")!.onclick=()=>{editingPlayerId="";renderMockWorkspace(root,hooks);};
  root.querySelector<HTMLButtonElement>("#mockSaveTournament")!.onclick=()=>{const form=root.querySelector("#mockTournamentForm")!;const item=tournamentFromForm(form,editingTournamentId);if(editingTournamentId)tournamentTemplates=tournamentTemplates.map(x=>x.id===editingTournamentId?item:x);else tournamentTemplates.push(item);editingTournamentId="";generated=null;renderMockWorkspace(root,hooks);};
  root.querySelector<HTMLButtonElement>("#mockResetTournament")!.onclick=()=>{editingTournamentId="";renderMockWorkspace(root,hooks);};
  root.querySelectorAll<HTMLButtonElement>("[data-edit-player]").forEach(b=>b.onclick=()=>{editingPlayerId=b.dataset.editPlayer!;renderMockWorkspace(root,hooks);});
  root.querySelectorAll<HTMLButtonElement>("[data-copy-player]").forEach(b=>b.onclick=()=>{const x=playerTemplates.find(p=>p.id===b.dataset.copyPlayer);if(x){playerTemplates.push({...x,id:id("pt"),baseName:`${x.baseName} copy`});generated=null;renderMockWorkspace(root,hooks);}});
  root.querySelectorAll<HTMLButtonElement>("[data-delete-player]").forEach(b=>b.onclick=()=>{playerTemplates=playerTemplates.filter(x=>x.id!==b.dataset.deletePlayer);generated=null;renderMockWorkspace(root,hooks);});
  const dpool=root.querySelector<HTMLButtonElement>("#mockDownloadPlayerPool");if(dpool)dpool.onclick=()=>download("players_mock_pool.csv",playersCsv(expandPlayerTemplates(playerTemplates)));
  root.querySelectorAll<HTMLButtonElement>("[data-edit-tournament]").forEach(b=>b.onclick=()=>{editingTournamentId=b.dataset.editTournament!;renderMockWorkspace(root,hooks);});
  root.querySelectorAll<HTMLButtonElement>("[data-copy-tournament]").forEach(b=>b.onclick=()=>{const x=tournamentTemplates.find(p=>p.id===b.dataset.copyTournament);if(x){tournamentTemplates.push({...x,id:id("tt"),name:`${x.name} copy`,months:[...x.months]});generated=null;renderMockWorkspace(root,hooks);}});
  root.querySelectorAll<HTMLButtonElement>("[data-delete-tournament]").forEach(b=>b.onclick=()=>{tournamentTemplates=tournamentTemplates.filter(x=>x.id!==b.dataset.deleteTournament);generated=null;renderMockWorkspace(root,hooks);});
  const cfg=(key:string)=>root.querySelector<HTMLInputElement>(`[data-gen-config="${key}"]`)!;
  root.querySelector<HTMLButtonElement>("#mockGenerateHistory")!.onclick=()=>{genConfig={seed:Math.floor(Number(cfg("seed").value)||1),startDate:cfg("startDate").value,endDate:cfg("endDate").value,neutralAlpha:Number(cfg("neutralAlpha").value)||.25,basePerformanceSigma:Number(cfg("basePerformanceSigma").value)||260};generated=generateMockHistory(playerTemplates,tournamentTemplates,genConfig);renderMockWorkspace(root,hooks);};
  const use=root.querySelector<HTMLButtonElement>("#mockUseDataset");if(use)use.onclick=()=>{if(generated)hooks.useDataset(generated.players,generated.results,`mock seed ${generated.manifest.seed}`);};
  const dp=root.querySelector<HTMLButtonElement>("#mockDownloadPlayers");if(dp)dp.onclick=()=>generated&&download("players_mock.csv",playersCsv(generated.players));
  const dr=root.querySelector<HTMLButtonElement>("#mockDownloadResults");if(dr)dr.onclick=()=>generated&&download("results_mock.csv",resultsCsv(generated.results));
  const dm=root.querySelector<HTMLButtonElement>("#mockDownloadManifest");if(dm)dm.onclick=()=>generated&&download("mock_manifest.json",JSON.stringify(generated.manifest,null,2),"application/json;charset=utf-8");
}

export function renderMockWorkspace(root:HTMLElement,hooks:MockUiHooks):void{
  const p=editingPlayerId?playerTemplates.find(x=>x.id===editingPlayerId)??defaultPlayer():defaultPlayer();
  const t=editingTournamentId?tournamentTemplates.find(x=>x.id===editingTournamentId)??defaultTournament():defaultTournament();
  const ready=playerTemplates.length>0&&tournamentTemplates.length>0;
  root.innerHTML=`
    <div class="mock-page">
      <section class="results-card"><div class="results-head"><div><div class="eyebrow">Mock data generator</div><h2>Игроки</h2><div class="formula-caption">Latent ELO и simulation-only поля сохраняются в CSV, но игнорируются рейтинговыми движками.</div></div></div>
        <div class="mock-editor-layout"><div class="mock-card"><h3>${editingPlayerId?"Редактирование шаблона":"Новый шаблон игрока"}</h3>${playerFormHtml(p)}<div class="mock-card-actions"><button id="mockSavePlayer" class="primary-button">${editingPlayerId?"Сохранить изменения":"Добавить в Mock"}</button><button id="mockResetPlayer" class="secondary-button">Сбросить</button></div></div><div id="mockPlayersTable" class="mock-pool"></div></div>
      </section>
      <section class="results-card"><div class="results-head"><div><div class="eyebrow">Mock data generator</div><h2>Турниры</h2><div class="formula-caption">External: сначала резервируются замены, затем квота внутренних игроков; все остальные места занимают <code>include_in_rating=false</code>. Если их не хватает — создаются одноразовые замены.</div></div></div>
        <div class="mock-editor-layout"><div class="mock-card"><h3>${editingTournamentId?"Редактирование шаблона":"Новый шаблон турнира"}</h3>${tournamentFormHtml(t)}<div class="mock-card-actions"><button id="mockSaveTournament" class="primary-button">${editingTournamentId?"Сохранить изменения":"Добавить в Mock"}</button><button id="mockResetTournament" class="secondary-button">Сбросить</button></div></div><div id="mockTournamentsTable" class="mock-pool"></div></div>
      </section>
      <section class="results-card"><div class="results-head"><div><div class="eyebrow">History simulator</div><h2>Generate history</h2><div class="formula-caption">Одинаковые шаблоны + seed дают идентичную синтетическую историю.</div></div></div>
        <div class="mock-generator-toolbar"><label>Seed <input data-gen-config="seed" type="number" step="1" value="${genConfig.seed}"></label><label>Начало <input data-gen-config="startDate" type="date" value="${genConfig.startDate}"></label><label>Конец <input data-gen-config="endDate" type="date" value="${genConfig.endDate}"></label><details><summary>Advanced</summary><label>Neutral α <input data-gen-config="neutralAlpha" type="number" min="0" max="1" step="0.05" value="${genConfig.neutralAlpha}"></label><label>Base performance σ <input data-gen-config="basePerformanceSigma" type="number" min="10" max="1000" step="10" value="${genConfig.basePerformanceSigma}"></label></details><button id="mockGenerateHistory" class="primary-button" ${ready?"":"disabled"}>Generate history</button></div>
        <div class="notice mock-rules"><strong>Порядок генерации турнира.</strong> Замены занимают зарезервированные места первыми. Игрок допускается только между <code>active_from</code> и <code>active_to</code>, но после ухода остаётся в итоговой рейтинговой истории. External-турнир допускает внутренних игроков только через рейтинговую квоту; остальные регулярные места отдаются зарубежному пулу. Места моделируются по турам с учётом latent ELO, stability, drift, числа туров, типа рассадки и tournament randomness.</div>
        <div id="mockGenerated"></div>
      </section>
    </div>`;
  renderTables(root);renderGenerated(root);bind(root,hooks);
}
