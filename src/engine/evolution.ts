import { EU_TO_LEVEL, LEVEL_VALUES } from "./legacyTables";
import type { EvolutionState, Mcr2026Config } from "./types";

export function cloneState(state: EvolutionState): EvolutionState {
  return {
    eu: state.eu,
    marks: state.marks,
    danDate: state.danDate ? new Date(state.danDate) : null,
    expiryPeriodsApplied: state.expiryPeriodsApplied,
  };
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
  constructor(private readonly config: Mcr2026Config) {}

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
    if (state.eu < this.config.protectedEu) {
      state.danDate = null;
      state.expiryPeriodsApplied = 0;
    }
    return state;
  }

  addSuccesses(state: EvolutionState, count: number): EvolutionState {
    for (let i = 0; i < Math.max(0, Math.trunc(count)); i += 1) {
      // Positive and negative marks cancel arithmetically.
      state.marks += 1;
      this.normalizeMarks(state);
    }
    return state;
  }

  addFailure(state: EvolutionState): EvolutionState {
    state.marks -= 1;
    return this.normalizeMarks(state);
  }

  /**
   * Appendix 3 inactivity rule.
   * Call this only for players who do NOT participate in the tournament
   * currently being processed.
   *
   * danDate remains the last tournament where EU_before <= NR * KT was met.
   * expiryPeriodsApplied prevents the same anniversary from being charged
   * repeatedly at every later tournament.
   */
  applyInactivity(state: EvolutionState, targetDate: Date): EvolutionState {
    if (state.eu < 2500 || !state.danDate) return state;

    // Appendix 3 v0.5: one inactivity minus after >1 year from the last
    // confirming tournament and one more for every following year. Two
    // accumulated minuses demote one dan and the marks counter resets through
    // normalizeMarks(). 1 dan and below are protected by the eu >= 2500 guard.
    while (state.eu >= 2500) {
      const nextPeriod = state.expiryPeriodsApplied + 1;
      const due = addMonths(
        state.danDate,
        nextPeriod * this.config.confirmationMonths,
      );

      // The first minus requires strictly more than one year. Subsequent
      // annual milestones are charged once their anniversary is reached.
      const reached = nextPeriod === 1
        ? targetDate > due
        : targetDate >= due;
      if (!reached) break;

      this.addFailure(state);
      state.expiryPeriodsApplied = nextPeriod;
    }

    return state;
  }

  /**
   * Applies one positive-rank calculation for a tournament.
   *
   * For 1 kyu and below, the player immediately receives the rank whose EU
   * is the nearest value not exceeding NR*KT.
   *
   * For 1 dan and above, floor((NR*KT - EU_before) / 500) pluses are earned.
   * Existing minuses are not erased first: pluses and minuses cancel.
   */
  processPerformance(
    state: EvolutionState,
    performance: number,
    tournamentDate: Date,
  ): { state: EvolutionState; norm: number; successesAdded: number; conditionMet: boolean } {
    const before = cloneState(state);
    const norm = performedNorm(performance);
    const conditionMet = before.eu <= performance;
    let successCount = 0;

    if (!conditionMet) {
      return { state, norm, successesAdded: 0, conditionMet: false };
    }

    if (before.eu <= 1750) {
      state.eu = norm;
      state.marks = 0;
      if (state.eu >= 2000) {
        state.danDate = tournamentDate;
        state.expiryPeriodsApplied = 0;
      } else {
        state.danDate = null;
        state.expiryPeriodsApplied = 0;
      }
      return { state, norm, successesAdded: 0, conditionMet: true };
    }

    // 1 dan and above: pluses are calculated from the raw NR*KT excess.
    successCount = Math.max(
      0,
      Math.floor((performance - before.eu) / this.config.danStep),
    );

    this.addSuccesses(state, successCount);

    // The condition itself, even if it yields zero pluses, confirms the dan.
    if (state.eu >= 2000) {
      state.danDate = tournamentDate;
      state.expiryPeriodsApplied = 0;
    }

    this.normalizeMarks(state);
    return { state, norm, successesAdded: successCount, conditionMet: true };
  }
}
