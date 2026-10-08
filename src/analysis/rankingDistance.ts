export interface DistanceSnapshotRow {
  playerId: string;
  rank: number;
}

export interface DistanceSnapshot {
  event: {
    tournamentId: string;
    tournamentDate: string;
    tournamentOrder: number;
  };
  ranking: DistanceSnapshotRow[];
  processedTournamentCount?: number;
}

export interface DistanceResultRow {
  tournamentId: string | number;
  tournamentDate: string;
  tournamentOrder?: number;
  playerId: string | number;
}

export type DistanceObservationKind = "first" | "repeat" | "end";

export interface DistanceObservation {
  playerId: string;
  rank: number;
  tournaments: number;
  kind: DistanceObservationKind;
  startDate: string;
  endDate: string;
}

export interface DistanceBin {
  from: number;
  to: number;
  label: string;
  observations: number;
  tournamentSum: number;
  meanTournaments: number;
  normalizedByAllTournaments: number;
}

export interface RankingDistanceMetric {
  observations: DistanceObservation[];
  bins: DistanceBin[];
  players: number;
  totalProcessedTournaments: number;
  horizonMonths: number;
  topN: number;
  step: number;
}

function eventKey(event: { tournamentId: string | number; tournamentDate: string; tournamentOrder?: number }): string {
  return `${String(event.tournamentDate)}\u0000${Number(event.tournamentOrder ?? 0)}\u0000${String(event.tournamentId)}`;
}


/**
 * Ranking-distance metric, revision 2 (Patrick clarification).
 *
 * For every ranked player:
 * 1. The player's first ranked position establishes the initial personal best. It is an anchor,
 *    not an observation: there is no previous achievement to exceed yet.
 * 2. Until the player first reaches rank #1, an observation is created ONLY when the player
 *    strictly improves the previous personal best (rank < bestRank). The tournament distance is
 *    the number of this player's processed tournaments after the previous personal-best anchor,
 *    including the tournament that sets the new best.
 * 3. Rank #1 ends the improvement phase. From that point onward, the target remains #1 and every
 *    later return to #1 creates a repeat observation with the number of the player's tournaments
 *    since the previous #1.
 * 4. If history ends after #1 without another return, the remaining player-tournament distance is
 *    retained as a censored trailing observation (`kind: "end"`, rank=1). If the player never
 *    reaches #1, no trailing non-improvement observation is added: before #1, pairs exist strictly
 *    on personal-best improvements.
 *
 * Only ranks <= topN are binned for charts. Raw observations are retained for CSV export.
 */
export function calculateRankingDistanceMetric(args: {
  snapshots: DistanceSnapshot[];
  results: DistanceResultRow[];
  horizonMonths: number; // kept for API compatibility; revision 2 does not use a decay horizon
  topN: number;
  step: number;
}): RankingDistanceMetric {
  const snapshots = [...args.snapshots].sort((a, b) =>
    a.event.tournamentDate.localeCompare(b.event.tournamentDate) ||
    a.event.tournamentOrder - b.event.tournamentOrder ||
    a.event.tournamentId.localeCompare(b.event.tournamentId)
  );
  const topN = Math.max(1, Math.floor(args.topN));
  const step = Math.max(1, Math.min(10, Math.floor(args.step)));
  // Retained in the result only for backward-compatible consumers/exports.
  // It no longer affects the metric after Patrick's clarification.
  const horizonMonths = Math.max(1, Math.floor(args.horizonMonths));

  const participantsByEvent = new Map<string, Set<string>>();
  for (const row of args.results) {
    const key = eventKey({
      tournamentId: row.tournamentId,
      tournamentDate: row.tournamentDate,
      tournamentOrder: row.tournamentOrder,
    });
    let set = participantsByEvent.get(key);
    if (!set) {
      set = new Set<string>();
      participantsByEvent.set(key, set);
    }
    set.add(String(row.playerId));
  }

  const processed: boolean[] = snapshots.map((snapshot, index) => {
    const current = Number(snapshot.processedTournamentCount ?? index + 1);
    const previous = index > 0 ? Number(snapshots[index - 1].processedTournamentCount ?? index) : 0;
    return current > previous;
  });

  const rankMaps = snapshots.map((snapshot) => new Map(snapshot.ranking.map((row) => [row.playerId, row.rank])));
  const rankedPlayers = new Set<string>();
  snapshots.forEach((snapshot) => snapshot.ranking.forEach((row) => rankedPlayers.add(row.playerId)));

  const observations: DistanceObservation[] = [];

  const didPlay = (snapshotIndex: number, playerId: string): boolean => {
    if (!processed[snapshotIndex]) return false;
    return participantsByEvent.get(eventKey(snapshots[snapshotIndex].event))?.has(playerId) ?? false;
  };

  for (const playerId of rankedPlayers) {
    let firstRanked = -1;
    let bestRank = Number.POSITIVE_INFINITY;

    // The first ranked state after a tournament played by the player is the baseline achievement.
    for (let i = 0; i < snapshots.length; i += 1) {
      if (!didPlay(i, playerId)) continue;
      const rank = rankMaps[i].get(playerId);
      if (rank === undefined) continue;
      firstRanked = i;
      bestRank = rank;
      break;
    }
    if (firstRanked < 0 || !Number.isFinite(bestRank)) continue;

    let anchorIndex = firstRanked;
    let tournamentsSinceAnchor = 0;
    let reachedTopOne = bestRank === 1;

    for (let i = firstRanked + 1; i < snapshots.length; i += 1) {
      if (didPlay(i, playerId)) tournamentsSinceAnchor += 1;
      if (tournamentsSinceAnchor <= 0) continue;

      const rank = rankMaps[i].get(playerId);
      if (rank === undefined) continue;

      if (!reachedTopOne) {
        // Before #1 only a STRICT personal best creates a pair.
        if (rank < bestRank) {
          observations.push({
            playerId,
            rank,
            tournaments: tournamentsSinceAnchor,
            kind: "first",
            startDate: snapshots[anchorIndex].event.tournamentDate,
            endDate: snapshots[i].event.tournamentDate,
          });
          bestRank = rank;
          anchorIndex = i;
          tournamentsSinceAnchor = 0;
          if (rank === 1) reachedTopOne = true;
        }
      } else if (rank === 1) {
        // Once #1 has been reached, measure distances between subsequent #1 returns.
        observations.push({
          playerId,
          rank: 1,
          tournaments: tournamentsSinceAnchor,
          kind: "repeat",
          startDate: snapshots[anchorIndex].event.tournamentDate,
          endDate: snapshots[i].event.tournamentDate,
        });
        anchorIndex = i;
        tournamentsSinceAnchor = 0;
      }
    }

    // Only the post-#1 phase has a censored residual interval.
    if (reachedTopOne && tournamentsSinceAnchor > 0) {
      let finalIndex = snapshots.length - 1;
      for (let i = snapshots.length - 1; i >= anchorIndex; i -= 1) {
        if (rankMaps[i].has(playerId)) {
          finalIndex = i;
          break;
        }
      }
      observations.push({
        playerId,
        rank: 1,
        tournaments: tournamentsSinceAnchor,
        kind: "end",
        startDate: snapshots[anchorIndex].event.tournamentDate,
        endDate: snapshots[finalIndex].event.tournamentDate,
      });
    }
  }

  const totalProcessedTournaments = processed.filter(Boolean).length;
  const bins: DistanceBin[] = [];
  for (let from = 1; from <= topN; from += step) {
    const to = Math.min(topN, from + step - 1);
    const sample = observations.filter((x) => x.rank >= from && x.rank <= to);
    const tournamentSum = sample.reduce((sum, x) => sum + x.tournaments, 0);
    bins.push({
      from,
      to,
      label: from === to ? `#${from}` : `#${from}–${to}`,
      observations: sample.length,
      tournamentSum,
      meanTournaments: sample.length ? tournamentSum / sample.length : 0,
      normalizedByAllTournaments: totalProcessedTournaments ? tournamentSum / totalProcessedTournaments : 0,
    });
  }

  return {
    observations,
    bins,
    players: rankedPlayers.size,
    totalProcessedTournaments,
    horizonMonths,
    topN,
    step,
  };
}
