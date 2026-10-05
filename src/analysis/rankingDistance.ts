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

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() + Math.max(0, Math.floor(months)));
  return date.toISOString().slice(0, 10);
}

/**
 * Implements the ranking-distance metric discussed by the working group.
 *
 * For every ranked player:
 * 1. Start at the player's first processed tournament.
 * 2. Take one full decay horizon for the selected method and find the best rank reached inside it.
 *    The mandatory first observation is (player tournaments inside that opening horizon; best rank reached).
 * 3. After the opening horizon, count the player's newly played processed tournaments until the player
 *    reaches the same or a better rank. Record the pair and start a new iteration. If the achieved rank
 *    is better, it becomes the next target.
 * 4. The mandatory trailing observation covers the last unfinished interval up to the end of the history
 *    and uses the player's rank at the end of that history.
 *
 * Only ranks <= topN are binned for the charts. The raw observations are retained for CSV export.
 */
export function calculateRankingDistanceMetric(args: {
  snapshots: DistanceSnapshot[];
  results: DistanceResultRow[];
  horizonMonths: number;
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

  const countPlayed = (playerId: string, from: number, to: number): number => {
    let count = 0;
    for (let i = Math.max(0, from); i <= Math.min(to, snapshots.length - 1); i += 1) {
      if (didPlay(i, playerId)) count += 1;
    }
    return count;
  };

  for (const playerId of rankedPlayers) {
    let firstPlayed = -1;
    for (let i = 0; i < snapshots.length; i += 1) {
      if (didPlay(i, playerId)) {
        firstPlayed = i;
        break;
      }
    }
    if (firstPlayed < 0) continue;

    const horizonEnd = addMonthsIso(snapshots[firstPlayed].event.tournamentDate, horizonMonths);
    let horizonLastIndex = firstPlayed;
    let bestRank = Number.POSITIVE_INFINITY;

    for (let i = firstPlayed; i < snapshots.length; i += 1) {
      if (snapshots[i].event.tournamentDate > horizonEnd) break;
      horizonLastIndex = i;
      const rank = rankMaps[i].get(playerId);
      if (rank !== undefined && rank < bestRank) bestRank = rank;
    }
    if (!Number.isFinite(bestRank)) continue;

    observations.push({
      playerId,
      rank: bestRank,
      tournaments: countPlayed(playerId, firstPlayed, horizonLastIndex),
      kind: "first",
      startDate: snapshots[firstPlayed].event.tournamentDate,
      endDate: snapshots[horizonLastIndex].event.tournamentDate,
    });

    let targetRank = bestRank;
    let lastAnchor = horizonLastIndex;
    let playedSinceAnchor = 0;

    for (let i = horizonLastIndex + 1; i < snapshots.length; i += 1) {
      if (didPlay(i, playerId)) playedSinceAnchor += 1;
      if (playedSinceAnchor <= 0) continue;
      const rank = rankMaps[i].get(playerId);
      if (rank !== undefined && rank <= targetRank) {
        observations.push({
          playerId,
          rank,
          tournaments: playedSinceAnchor,
          kind: "repeat",
          startDate: snapshots[lastAnchor].event.tournamentDate,
          endDate: snapshots[i].event.tournamentDate,
        });
        targetRank = rank;
        lastAnchor = i;
        playedSinceAnchor = 0;
      }
    }

    if (lastAnchor < snapshots.length - 1) {
      let finalRank: number | undefined;
      let finalIndex = snapshots.length - 1;
      for (let i = snapshots.length - 1; i >= lastAnchor; i -= 1) {
        const rank = rankMaps[i].get(playerId);
        if (rank !== undefined) {
          finalRank = rank;
          finalIndex = i;
          break;
        }
      }
      if (finalRank !== undefined) {
        observations.push({
          playerId,
          rank: finalRank,
          tournaments: countPlayed(playerId, lastAnchor + 1, finalIndex),
          kind: "end",
          startDate: snapshots[lastAnchor].event.tournamentDate,
          endDate: snapshots[finalIndex].event.tournamentDate,
        });
      }
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
