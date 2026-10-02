import { EU_TO_LEVEL, LEVEL_VALUES } from "./legacyTables";
import type { EvolutionState, LegacyConfig } from "./types";

export function cloneState(state: EvolutionState): EvolutionState {
  return { eu: state.eu, marks: state.marks, danDate: state.danDate ? new Date(state.danDate) : null };
}

export function performedNorm(value: number): number {
  let best = 0;
  for (const level of LEVEL_VALUES) {
    if (level <= value) best = level;
    else break;
  }
  return best;
}

export function levelLabel(eu: number, marks = 0): string {
  let label = EU_TO_LEVEL.get(eu)?.label ?? `EU ${eu}`;
  if (eu >= 2000) {
    if (marks > 0) label += "+".repeat(marks);
    if (marks < 0) label += "-".repeat(Math.abs(marks));
  }
  return label;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const wantedDay = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(wantedDay, lastDay));
  return d;
}

export class EvolutionEngine {
  constructor(private readonly config: LegacyConfig) {}

  normalizeMarks(state: EvolutionState): EvolutionState {
    while (state.marks >= this.config.successesPerStep) {
      if (state.eu < 7500) state.eu = Math.min(7500, state.eu + this.config.danStep);
      state.marks -= this.config.successesPerStep;
    }
    while (state.marks <= -this.config.failuresPerStep) {
      if (state.eu > this.config.protectedEu) {
        state.eu = Math.max(this.config.protectedEu, state.eu - this.config.danStep);
      }
      state.marks += this.config.failuresPerStep;
    }
    if (state.eu <= this.config.protectedEu && state.marks < 0) state.marks = 0;
    if (state.eu < 2500) state.danDate = null;
    return state;
  }

  addSuccesses(state: EvolutionState, count: number): EvolutionState {
    for (let i = 0; i < Math.max(0, Math.trunc(count)); i += 1) {
      state.marks += 1;
      this.normalizeMarks(state);
    }
    return state;
  }

  addFailure(state: EvolutionState): EvolutionState {
    state.marks -= 1;
    return this.normalizeMarks(state);
  }

  expireUntil(state: EvolutionState, targetDate: Date): EvolutionState {
    if (state.eu < 2500 || !state.danDate) return state;
    let nextDue = addMonths(state.danDate, this.config.confirmationMonths);
    while (nextDue <= targetDate && state.eu >= 2500 && state.danDate) {
      this.addFailure(state);
      if (state.eu >= 2500) {
        state.danDate = nextDue;
        nextDue = addMonths(state.danDate, this.config.confirmationMonths);
      } else {
        state.danDate = null;
      }
    }
    return state;
  }

  processPerformance(
    state: EvolutionState,
    performance: number,
    tournamentDate: Date,
    processedNorm = 0,
  ): { state: EvolutionState; processedNorm: number; norm: number; successesAdded: number } {
    const norm = performedNorm(performance);
    const before = cloneState(state);
    let successCount = 0;

    const permanent = Math.min(norm, this.config.protectedEu);
    if (permanent > state.eu) {
      state.eu = permanent;
      state.marks = 0;
      if (state.eu < 2500) state.danDate = null;
    }

    if (state.eu >= 2500 && norm >= state.eu) {
      if (state.marks < 0) state.marks = 0;
      state.danDate = tournamentDate;
    }

    const startThreshold = Math.max(this.config.protectedEu, before.eu, processedNorm);
    if (norm > startThreshold) {
      successCount = Math.max(0, Math.floor((norm - startThreshold) / this.config.danStep));
      this.addSuccesses(state, successCount);
      if (state.eu >= 2500) state.danDate = tournamentDate;
    }

    this.normalizeMarks(state);
    return { state, processedNorm: Math.max(processedNorm, norm), norm, successesAdded: successCount };
  }
}
