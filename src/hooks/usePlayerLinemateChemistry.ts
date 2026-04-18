/**
 * usePlayerLinemateChemistry
 *
 * Loads per-game play-by-play + shifts for a focus player, builds the
 * team chemistry matrix, and returns the pairs that involve the focus
 * player. Everything here hits the PBP cache first — repeat visits to
 * the Deep tab on the same day are instant.
 *
 * Positions are synthesized (every teammate tagged the same) so
 * buildChemistryMatrix's same-position pair filter admits every
 * player-teammate combination. The position filter is meaningful for
 * a full-roster view; for a single-player WOWY we want F and D
 * partners alike.
 */

import { useEffect, useState } from 'react';
import {
  fetchGamePlayByPlay,
  fetchPlayerSeasonGames,
  type GamePlayByPlay,
} from '../services/playByPlayService';
import {
  buildChemistryMatrix,
  type ChemistryPositionGroup,
  type PlayerPairChemistry,
} from '../services/chemistryAnalytics';
import { fetchTeamData } from '../services/teamStatsService';
import { CacheManager, ANALYTICS_CACHE } from '../utils/cacheUtils';
import { getCurrentSeason } from '../utils/seasonUtils';

interface ChemistryResult {
  pairs: PlayerPairChemistry[];
  gamesAnalyzed: number;
}

export function usePlayerLinemateChemistry(
  focusPlayerId: number | null,
  teamId: number | null,
  teamAbbrev: string | null,
  season: string = getCurrentSeason()
) {
  const [result, setResult] = useState<ChemistryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!focusPlayerId || !teamId || !teamAbbrev) {
      setResult(null);
      return;
    }

    const cacheKey = `player_linemate_chemistry_${focusPlayerId}_${season}`;
    const cached = CacheManager.get<ChemistryResult>(cacheKey);
    if (cached) {
      setResult(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [gameIds, teamData] = await Promise.all([
          fetchPlayerSeasonGames(focusPlayerId, season),
          fetchTeamData(teamAbbrev),
        ]);
        if (cancelled || gameIds.length === 0 || !teamData) {
          setIsLoading(false);
          return;
        }

        // Fetch each game's PBP (includes shifts). fetchGamePlayByPlay
        // caches each game for 24 h so repeat visits are cheap.
        const games: GamePlayByPlay[] = [];
        const batchSize = 6;
        for (let i = 0; i < gameIds.length; i += batchSize) {
          if (cancelled) return;
          const batch = gameIds.slice(i, i + batchSize);
          const pbpBatch = await Promise.allSettled(
            batch.map(id => fetchGamePlayByPlay(id))
          );
          for (const r of pbpBatch) {
            if (r.status === 'fulfilled') games.push(r.value);
          }
        }

        if (cancelled) return;

        // Roster-backed names and positions — every skater on the team,
        // forwards and defensemen alike. Goalies are excluded (no
        // linemate chemistry for them).
        const nameMap = new Map<number, string>();
        const positions = new Map<number, ChemistryPositionGroup>();
        for (const p of teamData.roster.forwards) {
          nameMap.set(p.playerId, p.fullName || `${p.firstName} ${p.lastName}`);
          positions.set(p.playerId, 'F');
        }
        for (const p of teamData.roster.defensemen) {
          nameMap.set(p.playerId, p.fullName || `${p.firstName} ${p.lastName}`);
          positions.set(p.playerId, 'D');
        }

        const allIds = Array.from(positions.keys());
        // Treat every skater as the same position group so the
        // same-position filter in buildChemistryMatrix admits both F
        // and D partners for a single-player WOWY view. The real F/D
        // split matters for a full-roster chemistry matrix, not here.
        const flatPositions = new Map<number, ChemistryPositionGroup>();
        for (const id of allIds) flatPositions.set(id, 'F');

        const matrix = await buildChemistryMatrix(
          games,
          teamId,
          allIds,
          nameMap,
          flatPositions
        );

        const focusPairs: PlayerPairChemistry[] = [];
        for (const pair of matrix.matrix.values()) {
          if (pair.player1Id === focusPlayerId || pair.player2Id === focusPlayerId) {
            focusPairs.push(pair);
          }
        }

        const output: ChemistryResult = {
          pairs: focusPairs,
          gamesAnalyzed: matrix.gamesAnalyzed,
        };

        CacheManager.set(cacheKey, output, ANALYTICS_CACHE.ADVANCED_ANALYTICS);
        if (!cancelled) setResult(output);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusPlayerId, teamId, season]);

  return { result, isLoading, error };
}
