import { NHL_API_BASE_URL } from './nhlApi';
import { calculateXG } from './xgModel';
import { API_CONFIG } from '../config/api';
import { CacheManager, ANALYTICS_CACHE } from '../utils/cacheUtils';
import { parseTimeToSeconds } from '../utils/timeUtils';
import { getFromCache, setInCache } from '../utils/indexedDBCache';

// NHL Stats API for shift data - proxied in dev, Cloudflare Worker in prod
const NHL_STATS_API_URL = API_CONFIG.NHL_STATS;

export interface PlayerShift {
  playerId: number;
  period: number;
  startTime: string; // MM:SS format
  endTime: string;   // MM:SS format
  teamId: number;
}

export interface ShotEvent {
  eventId: number;
  period: number;
  timeInPeriod: string;
  xCoord: number;
  yCoord: number;
  shotType: string;
  result: 'goal' | 'shot-on-goal' | 'missed-shot' | 'blocked-shot';
  shootingPlayerId: number;
  goalieInNetId?: number;
  teamId: number;
  situation: {
    homeTeamDefending: string;
    strength: string; // "ev", "pp", "sh"
  };
  // Players on ice when the shot occurred
  homePlayersOnIce: number[];
  awayPlayersOnIce: number[];
}

export interface PassEvent {
  eventId: number;
  period: number;
  timeInPeriod: string;
  fromPlayerId: number;
  toPlayerId: number;
  fromPlayerName?: string;
  toPlayerName?: string;
  teamId: number;
  completed: boolean;
}

export interface GamePlayByPlay {
  gameId: number;
  gameDate?: string;  // Game date for trend analysis
  homeTeamId: number;
  awayTeamId: number;
  shots: ShotEvent[];
  passes: PassEvent[];
  allEvents: any[];
  shifts: PlayerShift[]; // Player shift data for on-ice determination
}

/**
 * Fetch shift data for a specific game
 * Uses the NHL Stats API shiftcharts endpoint via Vite proxy
 * Exported for on-demand fetching when cached data lacks shifts
 */
export async function fetchGameShifts(gameId: number): Promise<PlayerShift[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    const response = await fetch(
      `${NHL_STATS_API_URL}/shiftcharts?cayenneExp=gameId=${gameId}`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Failed to fetch shift data for game ${gameId}`);
      return [];
    }

    const data = await response.json();
    const shifts: PlayerShift[] = [];

    // Parse shift data from response
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach((shift: any) => {
        if (shift.playerId && shift.period && shift.startTime && shift.endTime) {
          shifts.push({
            playerId: shift.playerId,
            period: shift.period,
            startTime: shift.startTime,
            endTime: shift.endTime,
            teamId: shift.teamId || 0,
          });
        }
      });
    }

    return shifts;
  } catch (error) {
    console.warn(`Error fetching shifts for game ${gameId}:`, error);
    return [];
  }
}

/**
 * Fetch play-by-play data for a specific game
 * Uses IndexedDB cache (persistent) with 24-hour TTL
 */
export async function fetchGamePlayByPlay(gameId: number): Promise<GamePlayByPlay> {
  const cacheKey = `pbp_${gameId}`;

  // Check IndexedDB cache first (persistent across sessions)
  const indexedDBCached = await getFromCache<GamePlayByPlay>(cacheKey);
  if (indexedDBCached) {
    return indexedDBCached;
  }

  // Fallback to localStorage cache (session)
  const localCached = CacheManager.get<GamePlayByPlay>(cacheKey);
  if (localCached) {
    // Migrate to IndexedDB for persistence
    setInCache(cacheKey, localCached, ANALYTICS_CACHE.PLAY_BY_PLAY).catch(console.error);
    return localCached;
  }

  try {
    // Fetch play-by-play and shift data in parallel (with timeout)
    const pbpController = new AbortController();
    const pbpTimeoutId = setTimeout(() => pbpController.abort(), 15000); // 15s timeout
    const [pbpResponse, shifts] = await Promise.all([
      fetch(`${NHL_API_BASE_URL}/gamecenter/${gameId}/play-by-play`, { signal: pbpController.signal }),
      fetchGameShifts(gameId),
    ]);
    clearTimeout(pbpTimeoutId);

    const response = pbpResponse;

    if (!response.ok) {
      throw new Error(`Failed to fetch play-by-play data: ${response.statusText}`);
    }

    const data = await response.json();

    // Extract team IDs from the response
    const homeTeamId = data.homeTeam?.id || 0;
    const awayTeamId = data.awayTeam?.id || 0;

    // Extract shot events and pass events from plays
    const shots: ShotEvent[] = [];
    const passes: PassEvent[] = [];
    const plays = data.plays || [];

    // Build a player name lookup from roster data if available
    const playerNameMap = new Map<number, string>();
    if (data.rosterSpots) {
      data.rosterSpots.forEach((player: any) => {
        if (player.playerId && player.firstName && player.lastName) {
          const firstName = typeof player.firstName === 'object' ? player.firstName.default : player.firstName;
          const lastName = typeof player.lastName === 'object' ? player.lastName.default : player.lastName;
          playerNameMap.set(player.playerId, `${firstName} ${lastName}`);
        }
      });
    }

    // Helper to get player name from various sources
    const getPlayerName = (playerId: number, play: any): string | undefined => {
      // First check our lookup map
      if (playerNameMap.has(playerId)) {
        return playerNameMap.get(playerId);
      }
      // Try to get from play details
      if (play.details?.firstName && play.details?.lastName) {
        const firstName = typeof play.details.firstName === 'object'
          ? play.details.firstName.default
          : play.details.firstName;
        const lastName = typeof play.details.lastName === 'object'
          ? play.details.lastName.default
          : play.details.lastName;
        return `${firstName} ${lastName}`;
      }
      return undefined;
    };

    plays.forEach((play: any, index: number) => {
      // Extract shots
      if (
        play.typeDescKey === 'shot-on-goal' ||
        play.typeDescKey === 'missed-shot' ||
        play.typeDescKey === 'blocked-shot' ||
        play.typeDescKey === 'goal'
      ) {
        // Only include plays with coordinate data
        if (play.details?.xCoord !== undefined && play.details?.yCoord !== undefined) {
          // For goals, NHL API uses scoringPlayerId; for shots it uses shootingPlayerId
          const shooterId = play.details?.shootingPlayerId ||
                           play.details?.scoringPlayerId ||
                           play.details?.playerId || 0;

          // Extract players on ice from the play data
          // NHL API provides homePlayersOnIce and awayPlayersOnIce arrays
          const homePlayersOnIce: number[] = (play.homePlayersOnIce || []).map(
            (p: any) => p.playerId || p
          );
          const awayPlayersOnIce: number[] = (play.awayPlayersOnIce || []).map(
            (p: any) => p.playerId || p
          );

          shots.push({
            eventId: play.eventId,
            period: play.periodDescriptor?.number || 1,
            timeInPeriod: play.timeInPeriod || '00:00',
            xCoord: play.details.xCoord,
            yCoord: play.details.yCoord,
            shotType: play.details.shotType || 'wrist',
            result: play.typeDescKey as 'goal' | 'shot-on-goal' | 'missed-shot' | 'blocked-shot',
            shootingPlayerId: shooterId,
            goalieInNetId: play.details?.goalieInNetId,
            teamId: play.details?.eventOwnerTeamId || 0,
            situation: {
              homeTeamDefending: play.situationCode?.split('')[0] || 'l',
              strength: play.situationCode || 'ev',
            },
            homePlayersOnIce,
            awayPlayersOnIce,
          });

          // Look for assists on goals - these are explicit passes
          if (play.typeDescKey === 'goal' && play.details?.assists) {
            const assists = play.details.assists;
            if (assists.length >= 1) {
              // Primary assist = pass to shooter
              passes.push({
                eventId: play.eventId * 1000 + 1,
                period: play.periodDescriptor?.number || 1,
                timeInPeriod: play.timeInPeriod || '00:00',
                fromPlayerId: assists[0].playerId,
                toPlayerId: shooterId,
                fromPlayerName: getPlayerName(assists[0].playerId, play) ||
                  (assists[0].firstName && assists[0].lastName
                    ? `${assists[0].firstName.default || assists[0].firstName} ${assists[0].lastName.default || assists[0].lastName}`
                    : undefined),
                toPlayerName: getPlayerName(shooterId, play),
                teamId: play.details.eventOwnerTeamId,
                completed: true,
              });
            }
            if (assists.length >= 2) {
              // Secondary assist = pass to primary assist
              passes.push({
                eventId: play.eventId * 1000 + 2,
                period: play.periodDescriptor?.number || 1,
                timeInPeriod: play.timeInPeriod || '00:00',
                fromPlayerId: assists[1].playerId,
                toPlayerId: assists[0].playerId,
                fromPlayerName: getPlayerName(assists[1].playerId, play) ||
                  (assists[1].firstName && assists[1].lastName
                    ? `${assists[1].firstName.default || assists[1].firstName} ${assists[1].lastName.default || assists[1].lastName}`
                    : undefined),
                toPlayerName: getPlayerName(assists[0].playerId, play) ||
                  (assists[0].firstName && assists[0].lastName
                    ? `${assists[0].firstName.default || assists[0].firstName} ${assists[0].lastName.default || assists[0].lastName}`
                    : undefined),
                teamId: play.details.eventOwnerTeamId,
                completed: true,
              });
            }
          }

          // Infer a pass if there was a previous play by a different player on the same team
          // Look back up to 3 plays to find related events
          for (let lookback = 1; lookback <= Math.min(3, index); lookback++) {
            const prevPlay = plays[index - lookback];
            const prevPlayerId = prevPlay.details?.playerId || prevPlay.details?.shootingPlayerId;

            if (
              prevPlay.details?.eventOwnerTeamId === play.details?.eventOwnerTeamId &&
              prevPlayerId &&
              prevPlayerId !== shooterId &&
              // Only consider certain event types as potential pass sources
              (prevPlay.typeDescKey === 'takeaway' ||
               prevPlay.typeDescKey === 'faceoff' ||
               prevPlay.typeDescKey === 'hit' ||
               prevPlay.typeDescKey === 'blocked-shot' ||
               !prevPlay.typeDescKey?.includes('shot'))
            ) {
              passes.push({
                eventId: prevPlay.eventId,
                period: prevPlay.periodDescriptor?.number || 1,
                timeInPeriod: prevPlay.timeInPeriod || '00:00',
                fromPlayerId: prevPlayerId,
                toPlayerId: shooterId,
                fromPlayerName: getPlayerName(prevPlayerId, prevPlay),
                toPlayerName: getPlayerName(shooterId, play),
                teamId: play.details.eventOwnerTeamId,
                completed: true,
              });
              break; // Only infer one pass per shot
            }
          }
        }
      }
    });

    // Extract game date if available
    const gameDate = data.gameDate || '';

    const result: GamePlayByPlay = {
      gameId,
      gameDate,
      homeTeamId,
      awayTeamId,
      shots,
      passes,
      allEvents: plays,
      shifts,
    };

    // Cache for 30 days - completed game PBP data never changes
    const LONG_TTL = 30 * 24 * 60 * 60 * 1000;
    await setInCache(cacheKey, result, LONG_TTL);
    CacheManager.set(cacheKey, result, LONG_TTL);

    return result;
  } catch (error) {
    console.error('Error fetching play-by-play data:', error);
    throw error;
  }
}

/**
 * Fetch all games for a player in a season
 */
export async function fetchPlayerSeasonGames(
  playerId: number,
  season: string
): Promise<number[]> {
  try {
    // This would need to fetch the player's game log to get all game IDs
    // For now, we'll return empty array and implement this later
    // The NHL API has endpoints like /player/{id}/game-log/{season}/{gameType}
    const response = await fetch(
      `${NHL_API_BASE_URL}/player/${playerId}/game-log/${season}/2`
    );

    if (!response.ok) {
      console.warn('Could not fetch player game log');
      return [];
    }

    const data = await response.json();

    // Extract game IDs from the game log
    const gameIds: number[] = [];
    if (data.gameLog) {
      data.gameLog.forEach((game: any) => {
        if (game.gameId) {
          gameIds.push(game.gameId);
        }
      });
    }

    return gameIds;
  } catch (error) {
    console.error('Error fetching player season games:', error);
    return [];
  }
}

/**
 * Check if a player was on ice during a shot using shift data
 */
function wasPlayerOnIceFromShifts(
  shot: ShotEvent,
  playerId: number,
  shifts: PlayerShift[]
): boolean {
  const shotPeriod = shot.period;
  const shotTimeSeconds = parseTimeToSeconds(shot.timeInPeriod);

  // Find shifts for this player in this period
  const playerShifts = shifts.filter(
    (shift) => shift.playerId === playerId && shift.period === shotPeriod
  );

  // Check if shot occurred during any of the player's shifts
  return playerShifts.some((shift) => {
    const shiftStart = parseTimeToSeconds(shift.startTime);
    const shiftEnd = parseTimeToSeconds(shift.endTime);
    return shotTimeSeconds >= shiftStart && shotTimeSeconds <= shiftEnd;
  });
}

/**
 * Get player-specific shot events from a game
 * Uses on-ice player data from each shot event to determine Corsi for/against
 */
export function filterPlayerShots(
  playByPlay: GamePlayByPlay,
  playerId: number,
  teamId: number,
  isHomeTeam: boolean
): { shotsFor: ShotEvent[]; shotsAgainst: ShotEvent[] } {
  const shotsFor: ShotEvent[] = [];
  const shotsAgainst: ShotEvent[] = [];

  playByPlay.shots.forEach((shot) => {
    // Check if player was on ice using the on-ice data embedded in each shot
    const playersOnIce = isHomeTeam
      ? shot.homePlayersOnIce
      : shot.awayPlayersOnIce;

    const playerWasOnIce =
      playersOnIce && playersOnIce.length > 0
        ? playersOnIce.includes(playerId)
        : wasPlayerOnIceFromShifts(shot, playerId, playByPlay.shifts);

    if (playerWasOnIce) {
      if (shot.teamId === teamId) {
        shotsFor.push(shot);
      } else {
        shotsAgainst.push(shot);
      }
    }
  });

  return { shotsFor, shotsAgainst };
}

/**
 * Get player-specific pass events from a game
 */
export function filterPlayerPasses(
  playByPlay: GamePlayByPlay,
  playerId: number,
  teamId: number
): PassEvent[] {
  return playByPlay.passes.filter(
    (pass) =>
      pass.teamId === teamId &&
      (pass.fromPlayerId === playerId || pass.toPlayerId === playerId)
  );
}

/**
 * Convert pass events to PassConnection format for network diagram
 */
export function convertToPassConnections(passes: PassEvent[]): any[] {
  // Group passes by from-to pairs
  const connectionMap = new Map<string, { passes: number; completions: number; from: string; to: string }>();

  passes.forEach((pass) => {
    const fromName = pass.fromPlayerName || `Player ${pass.fromPlayerId}`;
    const toName = pass.toPlayerName || `Player ${pass.toPlayerId}`;
    const key = `${fromName}→${toName}`;

    if (!connectionMap.has(key)) {
      connectionMap.set(key, {
        from: fromName,
        to: toName,
        passes: 0,
        completions: 0,
      });
    }

    const connection = connectionMap.get(key)!;
    connection.passes += 1;
    if (pass.completed) {
      connection.completions += 1;
    }
  });

  return Array.from(connectionMap.values());
}

/**
 * Convert NHL API coordinates to our chart format
 * NHL uses: x [-100, 100], y [-42.5, 42.5]
 * We'll normalize to [0, 100] for both axes for visualization
 */
export function normalizeCoordinates(xCoord: number, yCoord: number) {
  // Normalize X: -100 to 100 -> 0 to 100
  const normalizedX = ((xCoord + 100) / 200) * 100;

  // Normalize Y: -42.5 to 42.5 -> 0 to 100
  const normalizedY = ((yCoord + 42.5) / 85) * 100;

  return {
    x: Math.max(0, Math.min(100, normalizedX)),
    y: Math.max(0, Math.min(100, normalizedY)),
  };
}

/**
 * Calculate shot distance and angle from coordinates
 * Useful for expected goals calculations
 *
 * Angle is measured from the goal's perspective:
 * - 0 degrees = shot directly in front of net
 * - Higher angles = shot from the side
 */
export function calculateShotMetrics(xCoord: number, yCoord: number) {
  // Net is at x=89 (offensive zone), y=0 (center)
  // NHL coordinate system: x from -100 to 100, y from -42.5 to 42.5
  const netX = 89;

  // Handle shots from both ends of the ice
  // Shots from negative x are shooting at the other net (x = -89)
  const effectiveNetX = xCoord >= 0 ? netX : -netX;

  // Calculate distance in feet (NHL coordinates are approximately in feet)
  const distance = Math.sqrt(
    Math.pow(xCoord - effectiveNetX, 2) + Math.pow(yCoord, 2)
  );

  // Calculate shot angle from the goal's perspective
  // This is the angle between the center line and the shot location
  // 0 = directly in front, 90 = on the goal line
  const distanceFromGoalLine = Math.abs(effectiveNetX - xCoord);
  const lateralDistance = Math.abs(yCoord);

  // Angle in degrees (0 = center, higher = more to the side)
  const angle = distanceFromGoalLine > 0
    ? Math.atan(lateralDistance / distanceFromGoalLine) * (180 / Math.PI)
    : 90; // On the goal line itself

  return { distance, angle };
}

/**
 * ShotAttempt format for our analytics calculations
 */
export interface ShotAttempt {
  x: number;
  y: number;
  type: 'goal' | 'shot' | 'miss' | 'block';
  distance: number;
  angle: number;
  shotType?: 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap';
  strength?: '5v5' | 'PP' | 'SH' | '4v4' | '3v3';
  rebound?: boolean;
  rushShot?: boolean;
  xGoal?: number; // Expected goals probability (0-1)
}

/**
 * Convert NHL API ShotEvent to ShotAttempt format for our analytics
 * Keeps original NHL coordinates for proper visualization
 */
export function convertToShotAttempt(shotEvent: ShotEvent): ShotAttempt {
  // Calculate distance and angle from coordinates
  const { distance, angle } = calculateShotMetrics(
    shotEvent.xCoord,
    shotEvent.yCoord
  );

  // Keep original NHL coordinates for visualization
  // ShotChart.tsx uses convertToSVGCoords which expects these
  const x = shotEvent.xCoord;
  const y = shotEvent.yCoord;

  // Map result type
  let type: 'goal' | 'shot' | 'miss' | 'block';
  if (shotEvent.result === 'goal') type = 'goal';
  else if (shotEvent.result === 'shot-on-goal') type = 'shot';
  else if (shotEvent.result === 'missed-shot') type = 'miss';
  else type = 'block';

  // Map shot type
  const shotTypeMap: Record<string, 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap'> = {
    'wrist': 'wrist',
    'slap': 'slap',
    'snap': 'snap',
    'backhand': 'backhand',
    'tip': 'tip',
    'deflected': 'tip',
    'wrap-around': 'wrap',
  };

  const shotType = shotTypeMap[shotEvent.shotType?.toLowerCase()] || 'wrist';

  // Parse strength from situation code: [awayGoalies][awaySkaters][homeSkaters][homeGoalies]
  let strength: '5v5' | 'PP' | 'SH' | '4v4' | '3v3' = '5v5';
  const sitCode = shotEvent.situation?.strength || '';
  if (sitCode.length === 4) {
    const homeSkaters = parseInt(sitCode[2], 10); // Index 2 = home skaters
    const awaySkaters = parseInt(sitCode[1], 10); // Index 1 = away skaters
    if (homeSkaters > awaySkaters) strength = 'PP';
    else if (homeSkaters < awaySkaters) strength = 'SH';
    else if (homeSkaters === 4) strength = '4v4';
    else if (homeSkaters === 3) strength = '3v3';
  }

  // Calculate expected goals (xG)
  const xgPrediction = calculateXG({
    distance,
    angle,
    shotType,
    strength,
    isRebound: false,
    isRushShot: false,
  });

  return {
    x,
    y,
    type,
    distance,
    angle,
    shotType,
    strength,
    rebound: false,
    rushShot: false,
    xGoal: xgPrediction.xGoal,
  };
}

/**
 * Enrich shots in a game with on-ice player data derived from shift data.
 *
 * The NHL API does NOT include homePlayersOnIce/awayPlayersOnIce in play-by-play events.
 * This function uses shift data to determine which players were on ice for each shot.
 *
 * Requires game.shifts to be populated (via fetchGameShifts).
 * If shifts are empty, shots are returned unchanged.
 */
export function enrichShotsWithOnIcePlayers(game: GamePlayByPlay): GamePlayByPlay {
  if (!game.shifts || game.shifts.length === 0) return game;

  // Pre-index shifts by period and team for O(1) lookups
  const shiftIndex = new Map<string, PlayerShift[]>();
  for (const shift of game.shifts) {
    const key = `${shift.period}-${shift.teamId}`;
    if (!shiftIndex.has(key)) {
      shiftIndex.set(key, []);
    }
    shiftIndex.get(key)!.push(shift);
  }

  const enrichedShots = game.shots.map((shot) => {
    // Skip if already has on-ice data
    if (shot.homePlayersOnIce.length > 0 && shot.awayPlayersOnIce.length > 0) {
      return shot;
    }

    const shotTimeSec = parseTimeToSeconds(shot.timeInPeriod);

    // Find home players on ice
    const homeShifts = shiftIndex.get(`${shot.period}-${game.homeTeamId}`) || [];
    const homeOnIce = homeShifts
      .filter((s) => {
        const start = parseTimeToSeconds(s.startTime);
        const end = parseTimeToSeconds(s.endTime);
        return shotTimeSec >= start && shotTimeSec <= end;
      })
      .map((s) => s.playerId);

    // Find away players on ice
    const awayShifts = shiftIndex.get(`${shot.period}-${game.awayTeamId}`) || [];
    const awayOnIce = awayShifts
      .filter((s) => {
        const start = parseTimeToSeconds(s.startTime);
        const end = parseTimeToSeconds(s.endTime);
        return shotTimeSec >= start && shotTimeSec <= end;
      })
      .map((s) => s.playerId);

    // Deduplicate (shouldn't happen but be safe)
    return {
      ...shot,
      homePlayersOnIce: [...new Set(homeOnIce)],
      awayPlayersOnIce: [...new Set(awayOnIce)],
    };
  });

  return { ...game, shots: enrichedShots };
}
