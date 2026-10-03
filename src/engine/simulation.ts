
import { Mcr2026Engine } from "./legacy";
import type {
  InitialStateMode,
  Mcr2026Config,
  PlayerInput,
  RatingSnapshot,
  ResultInput,
  TableOverrides,
  TournamentEvent,
} from "./types";

function eventKey(row: ResultInput): string {
  return `${row.tournament_date}\u0000${Number(row.tournament_order ?? 0)}\u0000${row.tournament_id}`;
}

function orderedEvents(results: ResultInput[]): TournamentEvent[] {
  const map = new Map<string, TournamentEvent>();

  for (const row of results) {
    const key = eventKey(row);
    if (!map.has(key)) {
      map.set(key, {
        tournamentId: String(row.tournament_id),
        tournamentName: String(row.tournament_name),
        tournamentDate: String(row.tournament_date),
        tournamentOrder: Number(row.tournament_order ?? 0),
        participants: Number(row.participants),
        sessions: Number(row.sessions),
        isStatusTournament: Boolean(row.is_status_tournament),
      });
    }
  }

  return [...map.values()].sort((a, b) =>
    a.tournamentDate.localeCompare(b.tournamentDate)
    || a.tournamentOrder - b.tournamentOrder
    || a.tournamentId.localeCompare(b.tournamentId)
  );
}

function rowsForEvent(results: ResultInput[], event: TournamentEvent): ResultInput[] {
  return results.filter((row) =>
    String(row.tournament_id) === event.tournamentId
    && String(row.tournament_date) === event.tournamentDate
    && Number(row.tournament_order ?? 0) === event.tournamentOrder
  );
}

function playersForMode(players: PlayerInput[], mode: InitialStateMode): PlayerInput[] {
  if (mode === "imported") return players.map((p) => ({ ...p }));

  return players.map((p) => ({
    ...p,
    initial_eu: 0,
    initial_marks: 0,
    initial_dan_date: "",
  }));
}

/**
 * Sequential tournament simulation.
 *
 * Each snapshot is calculated from the exact prefix of events available at
 * that point. This matters when two tournaments share a date: later events on
 * the same date are not allowed to leak into an earlier snapshot.
 *
 * This implementation deliberately favors auditability over optimization.
 * The dataset is small enough for the browser MVP, and later this runner can
 * be replaced by incremental state transitions without changing the UI.
 */
export function simulateMcr2026History(
  playersInput: PlayerInput[],
  resultsInput: ResultInput[],
  config: Mcr2026Config,
  overrides: TableOverrides = {},
  initialStateMode: InitialStateMode = "clean",
): RatingSnapshot[] {
  const events = orderedEvents(resultsInput);
  const basePlayers = playersForMode(playersInput, initialStateMode);
  const prefix: ResultInput[] = [];
  const snapshots: RatingSnapshot[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    prefix.push(...rowsForEvent(resultsInput, event));

    const engine = new Mcr2026Engine(config, overrides);
    const result = engine.calculate(
      basePlayers,
      prefix,
      event.tournamentDate,
      { includeAllPlayers: initialStateMode === "imported" },
    );

    snapshots.push({
      index,
      event,
      result,
    });
  }

  return snapshots;
}
