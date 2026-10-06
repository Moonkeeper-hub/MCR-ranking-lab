/**
 * Minimal native TrueSkill factor-graph implementation for free-for-all
 * tournaments with unique final places (one player per team, no draws).
 *
 * This module intentionally has no runtime dependencies.
 */

export interface NativeTrueSkillRating {
  mu: number;
  sigma: number;
}

class Gaussian {
  pi: number;
  tau: number;

  constructor(mu = 0, sigma = Number.POSITIVE_INFINITY, pi?: number, tau?: number) {
    if (pi !== undefined || tau !== undefined) {
      this.pi = pi ?? 0;
      this.tau = tau ?? 0;
      return;
    }
    if (!Number.isFinite(sigma)) {
      this.pi = 0;
      this.tau = 0;
    } else {
      const variance = sigma * sigma;
      this.pi = variance > 0 ? 1 / variance : 0;
      this.tau = this.pi * mu;
    }
  }

  static fromNatural(pi: number, tau: number): Gaussian {
    return new Gaussian(0, Number.POSITIVE_INFINITY, pi, tau);
  }

  get mu(): number {
    return this.pi > 0 ? this.tau / this.pi : 0;
  }

  get sigma(): number {
    return this.pi > 0 ? Math.sqrt(1 / this.pi) : Number.POSITIVE_INFINITY;
  }

  multiply(other: Gaussian): Gaussian {
    return Gaussian.fromNatural(this.pi + other.pi, this.tau + other.tau);
  }

  divide(other: Gaussian): Gaussian {
    return Gaussian.fromNatural(this.pi - other.pi, this.tau - other.tau);
  }
}

class Variable extends Gaussian {
  readonly messages = new Map<Factor, Gaussian>();

  private setValue(value: Gaussian): number {
    const oldPi = this.pi;
    const oldTau = this.tau;
    this.pi = value.pi;
    this.tau = value.tau;
    return Math.max(Math.abs(oldTau - this.tau), Math.sqrt(Math.abs(oldPi - this.pi)));
  }

  updateMessage(factor: Factor, message: Gaussian): number {
    const oldMessage = this.messages.get(factor) ?? new Gaussian();
    const updated = this.divide(oldMessage).multiply(message);
    this.messages.set(factor, message);
    return this.setValue(updated);
  }

  updateValue(factor: Factor, value: Gaussian): number {
    const oldMessage = this.messages.get(factor) ?? new Gaussian();
    const oldValue = Gaussian.fromNatural(this.pi, this.tau);
    const newMessage = value.multiply(oldMessage).divide(oldValue);
    this.messages.set(factor, newMessage);
    return this.setValue(value);
  }

  cavity(factor: Factor): Gaussian {
    return this.divide(this.messages.get(factor) ?? new Gaussian());
  }
}

abstract class Factor {
  constructor(readonly vars: Variable[]) {
    for (const v of vars) v.messages.set(this, new Gaussian());
  }
}

class PriorFactor extends Factor {
  constructor(variable: Variable, readonly rating: NativeTrueSkillRating) {
    super([variable]);
  }

  down(): number {
    return this.vars[0].updateValue(this, new Gaussian(this.rating.mu, this.rating.sigma));
  }
}

class LikelihoodFactor extends Factor {
  constructor(readonly mean: Variable, readonly value: Variable, readonly variance: number) {
    super([mean, value]);
  }

  private calcA(cavity: Gaussian): number {
    if (cavity.pi <= 0) return 0;
    return 1 / (this.variance + 1 / cavity.pi);
  }

  down(): number {
    const cavity = this.mean.cavity(this);
    const a = this.calcA(cavity);
    return this.value.updateMessage(this, Gaussian.fromNatural(a, a * cavity.mu));
  }

  up(): number {
    const cavity = this.value.cavity(this);
    const a = this.calcA(cavity);
    return this.mean.updateMessage(this, Gaussian.fromNatural(a, a * cavity.mu));
  }
}

class SumFactor extends Factor {
  constructor(readonly sum: Variable, readonly terms: Variable[], readonly coeffs: number[]) {
    super([sum, ...terms]);
  }

  private update(target: Variable, terms: Variable[], coeffs: number[]): number {
    let mu = 0;
    let variance = 0;
    for (let i = 0; i < terms.length; i += 1) {
      const cavity = terms[i].cavity(this);
      const c = coeffs[i];
      mu += c * cavity.mu;
      if (cavity.pi <= 0) variance = Number.POSITIVE_INFINITY;
      else if (Number.isFinite(variance)) variance += (c * c) / cavity.pi;
    }
    if (!Number.isFinite(variance) || variance <= 0) {
      return target.updateMessage(this, new Gaussian());
    }
    const pi = 1 / variance;
    return target.updateMessage(this, Gaussian.fromNatural(pi, pi * mu));
  }

  down(): number {
    return this.update(this.sum, this.terms, this.coeffs);
  }

  up(index: number): number {
    const coeff = this.coeffs[index];
    const terms = [this.sum, ...this.terms.filter((_, i) => i !== index)];
    const coeffs = [1 / coeff, ...this.coeffs.filter((_, i) => i !== index).map((c) => -c / coeff)];
    return this.update(this.terms[index], terms, coeffs);
  }
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, max error ~1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function cdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function vWin(x: number): number {
  const denom = cdf(x);
  if (denom < 1e-300) return -x;
  return pdf(x) / denom;
}

function wWin(x: number): number {
  const v = vWin(x);
  return v * (v + x);
}

class TruncateFactor extends Factor {
  constructor(readonly variable: Variable) {
    super([variable]);
  }

  up(): number {
    const cavity = this.variable.cavity(this);
    if (cavity.pi <= 0) return 0;
    const sqrtPi = Math.sqrt(cavity.pi);
    const x = cavity.tau / sqrtPi;
    const v = vWin(x);
    const w = wWin(x);
    const denom = Math.max(1e-12, 1 - w);
    const pi = cavity.pi / denom;
    const tau = (cavity.tau + sqrtPi * v) / denom;
    return this.variable.updateMessage(this, Gaussian.fromNatural(pi - cavity.pi, tau - cavity.tau));
  }
}

/**
 * Rates a single free-for-all tournament with unique finishing positions.
 * `ratings` and `places` may be in any order; places must be unique.
 */
export function rateFreeForAll(
  ratings: NativeTrueSkillRating[],
  places: number[],
  beta: number,
  minDelta = 1e-5,
): NativeTrueSkillRating[] {
  if (ratings.length !== places.length) throw new Error("ratings/places length mismatch");
  if (ratings.length < 2) return ratings.map((r) => ({ ...r }));
  if (!(beta > 0) || !Number.isFinite(beta)) throw new Error("beta must be positive and finite");
  if (new Set(places).size !== places.length) throw new Error("TrueSkill free-for-all requires unique places");

  const order = ratings.map((_, i) => i).sort((a, b) => places[a] - places[b]);
  const sortedRatings = order.map((i) => ratings[i]);
  const n = sortedRatings.length;

  const ratingVars = Array.from({ length: n }, () => new Variable());
  const perfVars = Array.from({ length: n }, () => new Variable());
  const diffVars = Array.from({ length: n - 1 }, () => new Variable());

  const priorFactors = ratingVars.map((v, i) => new PriorFactor(v, sortedRatings[i]));
  const likelihoodFactors = ratingVars.map((v, i) => new LikelihoodFactor(v, perfVars[i], beta * beta));
  const diffFactors = diffVars.map((v, i) => new SumFactor(v, [perfVars[i], perfVars[i + 1]], [1, -1]));
  const truncFactors = diffVars.map((v) => new TruncateFactor(v));

  for (const f of priorFactors) f.down();
  for (const f of likelihoodFactors) f.down();

  if (n === 2) {
    diffFactors[0].down();
    truncFactors[0].up();
  } else {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      let delta = 0;
      for (let i = 0; i < diffFactors.length - 1; i += 1) {
        delta = Math.max(delta, diffFactors[i].down());
        delta = Math.max(delta, truncFactors[i].up());
        delta = Math.max(delta, diffFactors[i].up(1));
      }
      for (let i = diffFactors.length - 1; i > 0; i -= 1) {
        delta = Math.max(delta, diffFactors[i].down());
        delta = Math.max(delta, truncFactors[i].up());
        delta = Math.max(delta, diffFactors[i].up(0));
      }
      if (delta <= minDelta) break;
    }
  }

  // Push comparison evidence back to every performance node.
  diffFactors[0].up(0);
  diffFactors[diffFactors.length - 1].up(1);
  for (let i = 1; i < diffFactors.length; i += 1) diffFactors[i].up(0);
  for (let i = 0; i < diffFactors.length - 1; i += 1) diffFactors[i].up(1);

  for (const f of likelihoodFactors) f.up();

  const sortedResult = ratingVars.map((v) => ({ mu: v.mu, sigma: v.sigma }));
  const result = Array<NativeTrueSkillRating>(n);
  order.forEach((originalIndex, sortedIndex) => { result[originalIndex] = sortedResult[sortedIndex]; });
  return result;
}
