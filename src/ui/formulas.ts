
import katex from "katex";
import type { Mcr2026Config } from "../engine/types";

function hotspot(tex: string, token: string): string {
  return String.raw`\htmlClass{formula-hotspot}{\htmlData{formula-token=${token}}{${tex}}}`;
}

function render(tex: string): string {
  return katex.renderToString(tex, {
    displayMode: true,
    throwOnError: false,
    trust: true,
    strict: false,
    output: "html",
  });
}

function n(v: number, digits = 2): string {
  return Number(v).toFixed(digits);
}

export function renderMcr2026Math(config: Mcr2026Config): string {
  const euW = n(config.euWeight);
  const t5W = n(config.t5Weight);
  const topN = String(config.topN);
  const session = n(config.sessionCoef);
  const euNorm = String(Math.round(config.euNormalizer));
  const euRound = n(config.euRoundStep);
  const world = n(config.statusTournamentBonus);

  const rating = render(String.raw`
    \mathrm{Rating}
    =
    ${hotspot(euW, "wEU")}\cdot ${hotspot("EU", "EU")}
    +
    ${hotspot(t5W, "wT5")}\cdot ${hotspot("T5", "T5")}
  `);

  const t5 = render(String.raw`
    ${hotspot("T5", "T5")}
    =
    \frac{1}{${hotspot(topN, "topN")}}
    \sum_{i=1}^{${hotspot(topN, "topN")}}
    \left(
      ${hotspot("NR_i", "NR")}
      \cdot
      ${hotspot("KT_i", "KT")}
      \cdot
      ${hotspot("VT_i", "VT")}
    \right)
  `);

  const nr = render(String.raw`
    ${hotspot("NR_i", "NR")}
    =
    1000\cdot
    \frac{
      ${hotspot("N_i", "N")} - ${hotspot("p_i", "place")}
    }{
      ${hotspot("N_i", "N")} - 1
    }
  `);

  const kt = render(String.raw`
    ${hotspot("KT_i", "KT")}
    =
    ${hotspot("S_i", "KT_S")}\cdot ${hotspot(session, "sessionCoef")}
    +
    ${hotspot("KT_{\mathrm{ЧУТ}}(N_i)", "KT_N")}
    +
    \left\lfloor
      \frac{
        \left(\overline{${hotspot("EU", "EUbar")}}/${hotspot(euNorm, "euNormalizer")}\right)
        \cdot ${hotspot(n(config.euComponentScale), "euComponentScale")}
      }{
        ${hotspot(euRound, "euRoundStep")}
      }
    \right\rfloor
    \cdot ${hotspot(euRound, "euRoundStep")}
    +
    ${hotspot(world, "KT_W")}\cdot B_i
  `);

  const norm = render(String.raw`
    ${hotspot("NR_i", "NR")}
    \cdot
    ${hotspot("KT_i", "KT")}
    \ge
    ${hotspot("EU_i", "EU")}
    \quad\Longrightarrow\quad
    ${hotspot("\\mathrm{успех/неуспех}", "marks")}
    \quad\cdot\quad
    ${hotspot("\\mathrm{Double\\ Strike}", "DoubleStrike")}
  `);

  return `
    <div class="math-formula-stack">
      <div class="math-line math-line-primary">${rating}</div>
      <div class="math-line">${t5}</div>
      <div class="math-line math-line-secondary">${nr}</div>
      <div class="math-line">${kt}</div>
      <div class="math-line math-line-secondary">${norm}</div>
    </div>
  `;
}

import type { RrConfig } from "../engine/rr";

export function renderRrMath(config: RrConfig): string {
  const w1=n(config.firstPartWeight), w2=n(config.secondPartWeight);
  const scale=String(Math.round(config.baseRankScale));
  const base=String(config.firstPartBaseTournaments), share=n(config.firstPartAdditionalShare);
  const best=String(config.secondPartBestTournaments);

  const rating=render(String.raw`\mathrm{RR}=${hotspot(w1,"rrW1")}\,${hotspot("A","rrP1")}+${hotspot(w2,"rrW2")}\,${hotspot("B","rrP2")}`);
  const br=render(String.raw`${hotspot("R_i","rrBR")}=${hotspot(scale,"rrScale")}\cdot\frac{${hotspot("N_i","rrN")}-${hotspot("p_i","rrPlace")}}{${hotspot("N_i","rrN")}-1}`);
  const weight=render(String.raw`${hotspot("W_i","rrW")}=${hotspot("K_N(N_i)","rrKN")}+${hotspot("K_H(H_i)","rrKS")}`);
  const cut=render(String.raw`${hotspot("W_i^{cut}","rrCut")}=${hotspot("K_N(N)","rrKN")}+\frac{${hotspot("K_H(H_i)","rrKS")}+\overline{${hotspot("K_H","rrKS")}}}{2}`);
  const delta=render(String.raw`${hotspot("D_i","rrDelta")}=${hotspot("R_i","rrBR")}\cdot${hotspot("W_i","rrW")}\cdot${hotspot("A_i","rrAge")}`);
  const age=render(String.raw`${hotspot("A(m)","rrAge")}=\begin{cases}1,&m<${hotspot(String(config.ageFullMonths),"rrAge")}\\\max\!\left(0,1-\left\lceil\frac{m-${hotspot(String(config.ageFullMonths),"rrAge")}}{${hotspot(String(config.ageStepMonths),"rrAge")}}\right\rceil\cdot${hotspot(n(config.ageStepDrop,4),"rrAge")}\right),&${hotspot(String(config.ageFullMonths),"rrAge")}\le m<${hotspot(String(config.ageZeroMonths),"rrAge")}\\0,&m\ge${hotspot(String(config.ageZeroMonths),"rrAge")}\end{cases}`);
  const count=render(String.raw`${hotspot("m(T)","rrM")}=\begin{cases}T,&T\le${hotspot(base,"rrBaseCount")}\\${hotspot(base,"rrBaseCount")}+\left\lceil${hotspot(share,"rrShare")}(T-${hotspot(base,"rrBaseCount")})\right\rceil,&T>${hotspot(base,"rrBaseCount")}\end{cases}`);
  const p1=render(String.raw`${hotspot("A","rrP1")} = \max_{|S|=${hotspot("m(T)","rrM")}}\frac{\sum_{i\in S}${hotspot("D_i","rrDelta")}}{\sum_{i\in S}${hotspot("W_iA_i","rrWeightedK")}+\bigl(${hotspot(base,"rrBaseCount")}-|S|\bigr)_+${hotspot("F","rrFill")}}`);
  const p2=render(String.raw`${hotspot("B","rrP2")} = \frac{\sum_{i\in \mathrm{Top}${hotspot(best,"rrBestCount")}(D)}${hotspot("D_i","rrDelta")}}{\sum_{j=1}^{${hotspot(best,"rrBestCount")}}${hotspot("MAXK_j","rrMaxCoef")}}`);
  return `<div class="math-formula-stack"><div class="math-line math-line-primary">${rating}</div><div class="math-line math-line-secondary">${br}</div><div class="math-line">${weight}</div><div class="math-line math-line-secondary">${cut}</div><div class="math-line">${delta}</div><div class="math-line math-line-secondary">${age}</div><div class="math-line math-line-secondary">${count}</div><div class="math-line">${p1}</div><div class="math-line">${p2}</div></div>`;
}


import type { TrueSkillTournamentConfig } from "../engine/trueskillTournament";
import type { EloPlConfig } from "../engine/eloPl";

export function renderTrueSkillTournamentMath(config: TrueSkillTournamentConfig): string {
  const mu=n(25*config.muCoef), sigma=n((25/3)*config.sigmaCoef), beta=n((25/6)*config.betaCoef), tau=n((25/300)*config.tauCoef,4), k=n(3*config.kCoef);
  const main=render(String.raw`${hotspot("R","tsR")}=${hotspot("\\mu","tsMu")}-${hotspot(k,"tsK")}\,${hotspot("\\sigma","tsSigma")}`);
  const init=render(String.raw`${hotspot("\\mu_0","tsMu")}=${hotspot(mu,"tsMuCoef")},\quad ${hotspot("\\sigma_0","tsSigma")}=${hotspot(sigma,"tsSigmaCoef")},\quad ${hotspot("\\beta","tsBeta")}=${hotspot(beta,"tsBetaCoef")}`);
  const decay=render(String.raw`${hotspot("\\sigma_{prior}","tsDecay")}=\sqrt{${hotspot("\\sigma^2","tsSigma")}+\left(${hotspot(tau,"tsTauCoef")}\sqrt{${hotspot("\\Delta t_{years}","tsTime")}}\right)^2}`);
  const tw=render(String.raw`${hotspot("w_T","tsTournamentWeight")}=1+\frac{${hotspot(n(config.tournamentCorrectionCoef),"tsTournamentCoef")}}{3}\cdot\frac{\frac{${hotspot(n(config.participantsCoef),"tsParticipantsCoef")}}{3}${hotspot("s_N","tsSizeSignal")}+\frac{${hotspot(n(config.sessionsCoef),"tsSessionsCoef")}}{3}${hotspot("s_H","tsSessionSignal")}}{2}`);
  const upd=render(String.raw`${hotspot("\\mu'","tsUpdate")}=${hotspot("\\mu","tsMu")}+${hotspot("w_T","tsTournamentWeight")}\left(${hotspot("\\mu_{TS}","tsRawUpdate")}-${hotspot("\\mu","tsMu")}
ight),\quad ${hotspot("\\sigma'","tsUpdate")}=${hotspot("\\sigma","tsSigma")}+${hotspot("w_T","tsTournamentWeight")}\left(${hotspot("\\sigma_{TS}","tsRawUpdate")}-${hotspot("\\sigma","tsSigma")}
ight)`);
  return `<div class="math-formula-stack"><div class="math-line math-line-primary">${main}</div><div class="math-line math-line-secondary">${init}</div><div class="math-line">${decay}</div><div class="math-line math-line-secondary">${tw}</div><div class="math-line">${upd}</div></div>`;
}

export function renderEloPlMath(config: EloPlConfig): string {
  const p=render(String.raw`${hotspot("P(\\pi)","plLikelihood")}=\prod_{i=1}^{N}\frac{\exp\left(${hotspot("r_{\\pi_i}","plRating")}/${hotspot(n(config.plScale,2),"plScale")}\right)}{\sum_{j=i}^{N}\exp\left(${hotspot("r_{\\pi_j}","plRating")}/${hotspot(n(config.plScale,2),"plScale")}\right)}`);
  const start=render(String.raw`${hotspot("r_0","plStart")}=${hotspot(n(config.startRating,0),"plStart")}`);
  const g=render(String.raw`${hotspot("g_j","plGradient")}=1-\sum_{i=1}^{j}\frac{\exp(r_j/s)}{\sum_{k=i}^{N}\exp(r_k/s)}`);
  const factors=render(String.raw`${hotspot("F_N","plSizeCoef")}=1+\frac{${hotspot(n(config.sizeCoef),"plSizeCoef")}}{3}\frac{N-${hotspot(String(config.minPlayers),"plMinPlayers")}}{N},\quad ${hotspot("F_H","plSessionsCoef")}=1+\frac{${hotspot(n(config.sessionsCoef),"plSessionsCoef")}}{3}\frac{H-4}{H},\quad ${hotspot("F_E","plExperienceCoef")}=1+\frac{${hotspot(n(config.experienceCoef),"plExperienceCoef")}/3}{1+T/${hotspot(String(config.experienceHalfLife),"plHalfLife")}}`);
  const k=render(String.raw`${hotspot("K_j","plKeff")}=${hotspot(n(config.baseK,2),"plBaseK")}\cdot${hotspot("F_N","plSizeCoef")}\cdot${hotspot("F_E","plExperienceCoef")}\cdot${hotspot("F_H","plSessionsCoef")}`);
  const upd=render(String.raw`${hotspot("r'_j","plUpdate")}=${hotspot("r_j","plRating")}+${hotspot("K_j","plKeff")}\,${hotspot("g_j","plGradient")}`);
  const norm=render(String.raw`${hotspot("r_{display}","plNormalization")}=${hotspot("\\mathrm{Normalize}_{"+config.normalization.replace("-","\\text{-}")+"}","plNormalization")}\left(r\right)`);
  return `<div class="math-formula-stack"><div class="math-line math-line-primary">${p}</div><div class="math-line math-line-secondary">${start}</div><div class="math-line math-line-secondary">${g}</div><div class="math-line">${factors}</div><div class="math-line">${k}</div><div class="math-line math-line-secondary">${upd}</div><div class="math-line math-line-secondary">${norm}</div></div>`;
}

