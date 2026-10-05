
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

