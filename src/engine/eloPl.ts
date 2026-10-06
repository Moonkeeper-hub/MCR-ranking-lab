import type { MethodDiagnostic, PlayerInput, ResultInput } from "./types";

export type EloNormalization = "off" | "0-1000" | "0-3000";
export interface EloPlConfig {
  startRating: number;
  baseK: number;
  plScale: number;
  sizeCoef: number;
  experienceCoef: number;
  sessionsCoef: number;
  experienceHalfLife: number;
  minPlayers: number;
  normalization: EloNormalization;
}
export interface EloPlRow { rank:number; playerId:string; playerName:string; rating:number; rawRating:number; tournamentsCount:number; }
export interface EloPlResult { ranking:EloPlRow[]; diagnostics:MethodDiagnostic[]; isComplete:boolean; processedTournamentCount:number; skippedTournamentCount:number; }
export interface EloPlHistorySnapshot { index:number; event:{ tournamentId:string;tournamentName:string;tournamentDate:string;tournamentOrder:number;participants:number;sessions:number;isStatusTournament:boolean;}; ranking:EloPlRow[]; processedTournamentCount:number; }
interface State { rating:number; tournamentsCount:number; }
export function defaultEloPlConfig(): EloPlConfig { return { startRating:1500, baseK:32, plScale:400/Math.log(10), sizeCoef:1, experienceCoef:1, sessionsCoef:1, experienceHalfLife:10, minPlayers:4, normalization:"off" }; }
function clamp(v:number,lo:number,hi:number){return Math.max(lo,Math.min(hi,v));}
function eventKey(r:ResultInput){return `${r.tournament_date}\u0000${Number(r.tournament_order??0)}\u0000${r.tournament_id}`;}
function normalize(rows:Array<Omit<EloPlRow,"rating"|"rank">>, mode:EloNormalization):EloPlRow[]{
  const raw=rows.map(r=>r.rawRating); const min=Math.min(...raw),max=Math.max(...raw); const target=mode==="0-1000"?1000:mode==="0-3000"?3000:0;
  const mapped=rows.map(r=>({...r,rating:mode==="off"?r.rawRating:(max===min?target/2:((r.rawRating-min)/(max-min))*target),rank:0}));
  mapped.sort((a,b)=>b.rawRating-a.rawRating||a.playerName.localeCompare(b.playerName,"ru")); mapped.forEach((r,i)=>r.rank=i+1); return mapped;
}
export class EloPlEngine {
  readonly config:EloPlConfig;
  constructor(config:Partial<EloPlConfig>={}){this.config={...defaultEloPlConfig(),...config};}
  private makeRanking(players:PlayerInput[], states:Map<string,State>):EloPlRow[]{const byId=new Map(players.map(p=>[String(p.player_id),p]));return normalize([...states.entries()].filter(([id])=>byId.get(id)?.include_in_rating!==false).map(([id,s])=>({playerId:id,playerName:String(byId.get(id)?.player_name??id),rawRating:s.rating,tournamentsCount:s.tournamentsCount})),this.config.normalization);}
  private kEffective(state:State,participants:number,sessions:number):number{
    const sizeSignal=clamp((Math.max(participants,this.config.minPlayers)-this.config.minPlayers)/Math.max(participants,this.config.minPlayers),0,1);
    const sessionBase=4, h=Math.max(sessionBase,sessions||0),sessionSignal=clamp((h-sessionBase)/h,0,1);
    const expSignal=1/(1+state.tournamentsCount/Math.max(1,this.config.experienceHalfLife));
    return this.config.baseK*(1+clamp(this.config.sizeCoef,0,3)/3*sizeSignal)*(1+clamp(this.config.sessionsCoef,0,3)/3*sessionSignal)*(1+clamp(this.config.experienceCoef,0,3)/3*expSignal);
  }
  private run(players:PlayerInput[],results:ResultInput[],evaluationDate?:string,collect=false){
    const diagnostics:MethodDiagnostic[]=[];const states=new Map<string,State>();const byId=new Map(players.map(p=>[String(p.player_id),p]));const groups=new Map<string,ResultInput[]>();
    for(const row of results){if(evaluationDate&&String(row.tournament_date)>evaluationDate)continue;const k=eventKey(row),b=groups.get(k);if(b)b.push(row);else groups.set(k,[row]);}
    const events=[...groups.values()].sort((a,b)=>String(a[0].tournament_date).localeCompare(String(b[0].tournament_date))||Number(a[0].tournament_order??0)-Number(b[0].tournament_order??0)||String(a[0].tournament_id).localeCompare(String(b[0].tournament_id)));const snapshots:EloPlHistorySnapshot[]=[];let processed=0,skipped=0;
    for(const rows0 of events){const rows=[...rows0].sort((a,b)=>Number(a.place)-Number(b.place));const first=rows[0],participants=Number(first.participants||rows.length);const places=rows.map(r=>Number(r.place));
      if(rows.length<this.config.minPlayers||participants<this.config.minPlayers){skipped++;diagnostics.push({level:"warning",code:"PL_MIN_PLAYERS",message:`Турнир ${first.tournament_name}: меньше ${this.config.minPlayers} игроков`,tournamentId:String(first.tournament_id),tournamentName:String(first.tournament_name),tournamentDate:String(first.tournament_date)});continue;}
      if(new Set(places).size!==places.length||places.some(p=>!Number.isFinite(p)||p<1)){skipped++;diagnostics.push({level:"warning",code:"PL_PLACES",message:`Турнир ${first.tournament_name}: места должны быть уникальными положительными числами`,tournamentId:String(first.tournament_id),tournamentName:String(first.tournament_name),tournamentDate:String(first.tournament_date)});continue;}
      const prior=rows.map(r=>states.get(String(r.player_id))??{rating:this.config.startRating,tournamentsCount:0});const scale=Math.max(1e-6,this.config.plScale);const x=prior.map(s=>s.rating/scale);const mx=Math.max(...x);const q=x.map(v=>Math.exp(v-mx));const suffix=new Array(q.length);let sum=0;for(let i=q.length-1;i>=0;i--){sum+=q[i];suffix[i]=sum;}
      const grads=q.map((qi,j)=>{let g=1;for(let i=0;i<=j;i++)g-=qi/suffix[i];return g;});
      rows.forEach((r,i)=>{const id=String(r.player_id),s=prior[i],k=this.kEffective(s,participants,Number(first.sessions||0));states.set(id,{rating:s.rating+k*grads[i],tournamentsCount:s.tournamentsCount+1});if(!byId.has(id))byId.set(id,{player_id:id,player_name:id,include_in_rating:true});});
      processed++;if(collect)snapshots.push({index:snapshots.length,event:{tournamentId:String(first.tournament_id),tournamentName:String(first.tournament_name),tournamentDate:String(first.tournament_date),tournamentOrder:Number(first.tournament_order??0),participants,sessions:Number(first.sessions||0),isStatusTournament:Boolean(first.is_status_tournament)},ranking:this.makeRanking([...byId.values()],states),processedTournamentCount:processed});
    }
    return {ranking:this.makeRanking([...byId.values()],states),diagnostics,isComplete:skipped===0,processedTournamentCount:processed,skippedTournamentCount:skipped,snapshots};
  }
  calculate(players:PlayerInput[],results:ResultInput[],evaluationDate?:string):EloPlResult{const r=this.run(players,results,evaluationDate,false);return {ranking:r.ranking,diagnostics:r.diagnostics,isComplete:r.isComplete,processedTournamentCount:r.processedTournamentCount,skippedTournamentCount:r.skippedTournamentCount};}
  history(players:PlayerInput[],results:ResultInput[]):EloPlHistorySnapshot[]{return this.run(players,results,undefined,true).snapshots;}
}
