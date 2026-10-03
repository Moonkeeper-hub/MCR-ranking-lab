
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
