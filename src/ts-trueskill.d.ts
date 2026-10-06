declare module "ts-trueskill" {
  export class Rating { constructor(mu?: number, sigma?: number); mu:number; sigma:number; }
  export class TrueSkill {
    constructor(mu?:number,sigma?:number,beta?:number,tau?:number,drawProbability?:number);
    rate(ratingGroups: Rating[][], ranks?: number[] | null, weights?: number[][] | null, minDelta?: number): Rating[][];
  }
}
