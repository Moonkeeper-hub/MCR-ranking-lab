import { Mcr2026Engine } from "../engine/legacy";
import { RrEngine } from "../engine/rr";
import { simulateMcr2026History } from "../engine/simulation";
import type { Mcr2026Config, PlayerInput, ResultInput, TableOverrides, InitialStateMode } from "../engine/types";
import type { RrConfig, RrOverrides } from "../engine/rr";

let players: PlayerInput[] = [];
let results: ResultInput[] = [];
let datasetRevision = -1;

interface WorkerMessage {
  type: "init" | "job";
  revision: number;
  players?: PlayerInput[];
  results?: ResultInput[];
  id?: number;
  job?: any;
}

function eventKey(row: ResultInput): string {
  return `${String(row.tournament_date)}\u0000${Number(row.tournament_order ?? 0)}\u0000${String(row.tournament_id)}`;
}

function rrHistory(config: RrConfig, overrides: RrOverrides) {
  const map = new Map<string, any>();
  const rowMap = new Map<string, ResultInput[]>();
  for (const row of results) {
    const event = {
      tournamentId: String(row.tournament_id),
      tournamentName: String(row.tournament_name),
      tournamentDate: String(row.tournament_date),
      tournamentOrder: Number(row.tournament_order ?? 0),
      participants: Number(row.participants),
      sessions: Number(row.sessions),
      isStatusTournament: Boolean(row.is_status_tournament),
    };
    const key = eventKey(row);
    if (!map.has(key)) map.set(key, event);
    const bucket = rowMap.get(key);
    if (bucket) bucket.push(row); else rowMap.set(key, [row]);
  }
  const events = [...map.values()].sort((a,b) =>
    a.tournamentDate.localeCompare(b.tournamentDate) ||
    a.tournamentOrder - b.tournamentOrder ||
    a.tournamentId.localeCompare(b.tournamentId)
  );
  const prefix: ResultInput[] = [];
  return events.map((event, index) => {
    const rows = rowMap.get(`${event.tournamentDate}\u0000${event.tournamentOrder}\u0000${event.tournamentId}`);
    if (rows) prefix.push(...rows);
    const result = new RrEngine(config, overrides).calculate(players, prefix, event.tournamentDate);
    return {
      index,
      event,
      ranking: result.ranking.map((r) => ({
        rank: r.rank,
        playerId: r.playerId,
        playerName: r.playerName,
        rating: r.rating,
        tournamentsCount: r.tournamentsCount,
      })),
      processedTournamentCount: result.processedTournamentCount,
    };
  });
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  if (msg.type === "init") {
    players = msg.players ?? [];
    results = msg.results ?? [];
    datasetRevision = msg.revision;
    return;
  }

  if (msg.type !== "job" || msg.id === undefined || !msg.job) return;
  const id = msg.id;
  try {
    if (msg.revision !== datasetRevision) throw new Error("Worker dataset revision is stale");
    const job = msg.job;
    let value: unknown;
    switch (job.kind) {
      case "mcr":
        value = new Mcr2026Engine(job.config as Mcr2026Config, job.overrides as TableOverrides)
          .calculate(players, results, job.evaluationDate);
        break;
      case "rr":
        value = new RrEngine(job.config as RrConfig, job.overrides as RrOverrides)
          .calculate(players, results, job.evaluationDate);
        break;
      case "mcr-history": {
        const snapshots = simulateMcr2026History(
          players,
          results,
          job.config as Mcr2026Config,
          job.overrides as TableOverrides,
          job.initialMode as InitialStateMode,
        );
        value = snapshots.map((s) => ({
          index: s.index,
          event: s.event,
          ranking: s.result.ranking.map((r) => ({
            rank: r.rank,
            playerId: r.playerId,
            playerName: r.playerName,
            rating: r.rating,
            tournamentsCount: r.tournamentsCount,
            level: r.level,
            currentEu: r.currentEu,
            t5: r.t5,
          })),
          processedTournamentCount: s.result.processedTournamentCount,
        }));
        break;
      }
      case "rr-history":
        value = rrHistory(job.config as RrConfig, job.overrides as RrOverrides);
        break;
      default:
        throw new Error(`Unknown rating worker job: ${String(job.kind)}`);
    }
    postMessage({ type: "result", id, value });
  } catch (error) {
    postMessage({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
  }
};
