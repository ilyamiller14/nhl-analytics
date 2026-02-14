/**
 * Zone Entry and Exit Tracking Service
 *
 * Tracks how teams/players enter and exit zones with possession
 * Analyzes controlled entries vs dump-ins, exit success rates
 */

// TODO: type properly with full NHL play-by-play event schema
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlayByPlayEvent = Record<string, any>;

export type ZoneType = 'defensive' | 'neutral' | 'offensive';
export type EntryType = 'controlled' | 'dump' | 'pass';
export type ExitType = 'controlled' | 'clear' | 'pass';

export interface ZoneEntry {
  eventId: number;
  playerId: number;
  playerName?: string;
  teamId: number;
  period: number;
  timeInPeriod: string;
  entryType: EntryType;
  xCoord: number;
  yCoord: number;
  success: boolean; // Did the team maintain possession after entry?
  shotWithin5Seconds?: boolean; // Did entry lead to quick shot?
}

export interface ZoneExit {
  eventId: number;
  playerId: number;
  playerName?: string;
  teamId: number;
  period: number;
  timeInPeriod: string;
  exitType: ExitType;
  xCoord: number;
  yCoord: number;
  success: boolean; // Did the team successfully exit without turnover?
}

export interface ZoneTransition {
  entry?: ZoneEntry;
  exit?: ZoneExit;
  transitionTime?: number; // Time from exit to entry in seconds
}

export interface ZoneAnalytics {
  entries: ZoneEntry[];
  exits: ZoneExit[];
  totalEntries: number;
  controlledEntries: number;
  dumpIns: number;
  controlledEntryRate: number;
  successfulExits: number;
  totalExits: number;
  exitSuccessRate: number;
}

/**
 * Determine which zone an event occurred in based on x-coordinate
 * NHL API uses center ice = 0, with x ranging from -100 to 100
 * Blue lines are at approximately x = ±25
 * Returns 'positive' for x > 25, 'negative' for x < -25, 'neutral' for middle
 */
export function getZoneRaw(xCoord: number): 'positive' | 'negative' | 'neutral' {
  if (xCoord > 25) return 'positive';   // Right end zone
  if (xCoord < -25) return 'negative';  // Left end zone
  return 'neutral';  // Center ice area
}

/**
 * Determine zone type relative to attacking direction
 * For backwards compatibility
 */
export function getZone(xCoord: number): ZoneType {
  if (Math.abs(xCoord) > 25) return 'offensive';
  return 'neutral';
}

/**
 * Check if movement represents a zone entry (crossing from neutral into either end zone)
 */
function isZoneEntry(prevX: number, currX: number): boolean {
  const prevZone = getZoneRaw(prevX);
  const currZone = getZoneRaw(currX);
  // Entry = went from neutral to either end zone
  return prevZone === 'neutral' && (currZone === 'positive' || currZone === 'negative');
}

/**
 * Detect zone entries from play-by-play events
 *
 * Entry detection logic:
 * - Track when events cross from neutral zone into either end zone
 * - Teams switch ends each period, so we detect entries in both directions
 * - Controlled = same team had possession before AND after crossing the line
 * - Dump = puck was dumped in (different team had last touch, or immediate turnover)
 */
export function detectZoneEntries(allEvents: PlayByPlayEvent[]): ZoneEntry[] {
  const entries: ZoneEntry[] = [];

  // Events that indicate possession was lost immediately after entry
  const possessionLostIndicators = [
    'faceoff',        // Whistle = possession ended
    'giveaway',       // Lost puck after entry
    'stoppage',
  ];

  // Events that indicate controlled possession in the zone
  const possessionIndicators = [
    'shot-on-goal',   // Taking a shot = had possession
    'goal',           // Scored = had possession
    'hit',            // Making a hit = has puck
    'takeaway',       // Won puck
  ];

  for (let i = 1; i < allEvents.length; i++) {
    const prevEvent = allEvents[i - 1];
    const currEvent = allEvents[i];

    // Skip if missing coordinate data
    if (
      prevEvent.details?.xCoord === undefined ||
      currEvent.details?.xCoord === undefined ||
      !currEvent.details?.eventOwnerTeamId
    ) {
      continue;
    }

    const prevX = prevEvent.details.xCoord;
    const currX = currEvent.details.xCoord;

    // Check if blue line was crossed into either end zone
    if (isZoneEntry(prevX, currX)) {
      const teamId = currEvent.details.eventOwnerTeamId;
      const prevTeamId = prevEvent.details?.eventOwnerTeamId;

      // Determine entry type based on possession continuity
      let entryType: EntryType;

      // Check if same team had possession before the entry
      const sameTeamBeforeEntry = prevTeamId === teamId;

      // Check if immediate possession loss after entry
      const immediateLoss = possessionLostIndicators.includes(currEvent.typeDescKey);

      // Check if team maintains possession (taking shots, making plays)
      const hasPossession = possessionIndicators.includes(currEvent.typeDescKey);

      if (immediateLoss) {
        // Lost possession immediately = dump that failed
        entryType = 'dump';
      } else if (sameTeamBeforeEntry || hasPossession) {
        // Same team before AND after = controlled entry
        // OR team is making plays in the zone = had control
        entryType = 'controlled';
      } else {
        // Different team before entry, need to check context
        // Look at next few events to determine if controlled
        const currEndZone = getZoneRaw(currX);
        let teamEventsInZone = 0;
        for (let j = i; j < Math.min(i + 4, allEvents.length); j++) {
          const checkEvent = allEvents[j];
          if (
            checkEvent.details?.eventOwnerTeamId === teamId &&
            checkEvent.details?.xCoord !== undefined &&
            getZoneRaw(checkEvent.details.xCoord) === currEndZone
          ) {
            teamEventsInZone++;
          } else if (checkEvent.details?.eventOwnerTeamId !== teamId) {
            break; // Other team took over
          }
        }
        // If team has multiple events in zone, they carried it in
        entryType = teamEventsInZone >= 2 ? 'controlled' : 'dump';
      }

      // Check if entry led to sustained possession (next few events)
      const success = checkEntrySustained(allEvents, i, teamId);

      // Check if entry led to quick shot
      const shotWithin5Seconds = checkQuickShot(allEvents, i, 5);

      entries.push({
        eventId: currEvent.eventId,
        playerId: currEvent.details.playerId || currEvent.details.scoringPlayerId || currEvent.details.shootingPlayerId || 0,
        playerName:
          currEvent.details.firstName && currEvent.details.lastName
            ? `${currEvent.details.firstName.default} ${currEvent.details.lastName.default}`
            : undefined,
        teamId,
        period: currEvent.periodDescriptor?.number || 1,
        timeInPeriod: currEvent.timeInPeriod || '00:00',
        entryType,
        xCoord: currX,
        yCoord: currEvent.details.yCoord || 0,
        success,
        shotWithin5Seconds,
      });
    }
  }

  return entries;
}

/**
 * Check if zone entry was sustained (no immediate turnover or faceoff)
 */
function checkEntrySustained(
  allEvents: PlayByPlayEvent[],
  entryIndex: number,
  teamId: number
): boolean {
  // Look at next 3-5 events
  for (let i = entryIndex + 1; i < Math.min(entryIndex + 5, allEvents.length); i++) {
    const event = allEvents[i];

    // If different team gains possession, entry failed
    if (
      event.details?.eventOwnerTeamId &&
      event.details.eventOwnerTeamId !== teamId
    ) {
      return false;
    }

    // If faceoff, consider entry unsuccessful
    if (event.typeDescKey === 'faceoff') {
      return false;
    }

    // If shot, pass, or maintained zone, consider successful
    if (
      event.typeDescKey === 'shot-on-goal' ||
      event.typeDescKey === 'goal' ||
      event.typeDescKey === 'hit'
    ) {
      return true;
    }
  }

  return true; // Default to successful if no clear turnover
}

/**
 * Check if entry led to a shot within X seconds
 */
function checkQuickShot(
  allEvents: PlayByPlayEvent[],
  entryIndex: number,
  withinSeconds: number
): boolean {
  const entryEvent = allEvents[entryIndex];
  const entryTime = parseTime(entryEvent.timeInPeriod);

  // Look at next events
  for (let i = entryIndex + 1; i < Math.min(entryIndex + 10, allEvents.length); i++) {
    const event = allEvents[i];
    const eventTime = parseTime(event.timeInPeriod);

    // Check if within time window
    if (Math.abs(eventTime - entryTime) > withinSeconds) {
      break;
    }

    // Check if it's a shot
    if (
      event.typeDescKey === 'shot-on-goal' ||
      event.typeDescKey === 'missed-shot' ||
      event.typeDescKey === 'goal'
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if movement represents a zone exit (crossing from end zone into neutral)
 */
function isZoneExit(prevX: number, currX: number): boolean {
  const prevZone = getZoneRaw(prevX);
  const currZone = getZoneRaw(currX);
  // Exit = went from either end zone to neutral
  return (prevZone === 'positive' || prevZone === 'negative') && currZone === 'neutral';
}

/**
 * Detect zone exits from play-by-play events
 * Tracks exits from BOTH end zones since teams switch sides each period
 */
export function detectZoneExits(allEvents: PlayByPlayEvent[]): ZoneExit[] {
  const exits: ZoneExit[] = [];

  for (let i = 1; i < allEvents.length; i++) {
    const prevEvent = allEvents[i - 1];
    const currEvent = allEvents[i];

    // Skip if missing coordinate data
    if (
      prevEvent.details?.xCoord === undefined ||
      currEvent.details?.xCoord === undefined ||
      !currEvent.details?.eventOwnerTeamId
    ) {
      continue;
    }

    const prevX = prevEvent.details.xCoord;
    const currX = currEvent.details.xCoord;

    // Check if blue line was crossed out of either end zone into neutral
    if (isZoneExit(prevX, currX)) {
      const teamId = currEvent.details.eventOwnerTeamId;

      // Determine exit type
      let exitType: ExitType;

      if (currEvent.typeDescKey === 'hit' || currEvent.typeDescKey === 'takeaway') {
        exitType = 'clear'; // Cleared under pressure
      } else if (
        currEvent.typeDescKey === 'shot-on-goal' ||
        currEvent.typeDescKey === 'pass'
      ) {
        exitType = 'pass'; // Passed out
      } else {
        exitType = 'controlled'; // Carried out
      }

      // Check if exit was successful (maintained possession in next zone)
      const success = checkExitSuccess(allEvents, i, teamId);

      exits.push({
        eventId: currEvent.eventId,
        playerId: currEvent.details.playerId || currEvent.details.scoringPlayerId || currEvent.details.shootingPlayerId || 0,
        playerName:
          currEvent.details.firstName && currEvent.details.lastName
            ? `${currEvent.details.firstName.default} ${currEvent.details.lastName.default}`
            : undefined,
        teamId,
        period: currEvent.periodDescriptor?.number || 1,
        timeInPeriod: currEvent.timeInPeriod || '00:00',
        exitType,
        xCoord: currX,
        yCoord: currEvent.details.yCoord || 0,
        success,
      });
    }
  }

  return exits;
}

/**
 * Check if zone exit was successful (no immediate turnover)
 */
function checkExitSuccess(
  allEvents: PlayByPlayEvent[],
  exitIndex: number,
  teamId: number
): boolean {
  // Look at next few events
  for (let i = exitIndex + 1; i < Math.min(exitIndex + 4, allEvents.length); i++) {
    const event = allEvents[i];

    // If different team gains possession immediately, exit failed
    if (
      event.details?.eventOwnerTeamId &&
      event.details.eventOwnerTeamId !== teamId &&
      (event.typeDescKey === 'takeaway' ||
        event.typeDescKey === 'shot-on-goal' ||
        event.typeDescKey === 'hit')
    ) {
      return false;
    }
  }

  return true; // Default to successful
}

/**
 * Parse time string (MM:SS) to seconds
 */
function parseTime(timeString: string): number {
  if (!timeString) return 0;
  const [minutes, seconds] = timeString.split(':').map(Number);
  return minutes * 60 + seconds;
}

/**
 * Calculate zone entry/exit analytics
 */
export function calculateZoneAnalytics(
  entries: ZoneEntry[],
  exits: ZoneExit[]
): ZoneAnalytics {
  const totalEntries = entries.length;
  const controlledEntries = entries.filter((e) => e.entryType === 'controlled').length;
  const dumpIns = entries.filter((e) => e.entryType === 'dump').length;
  const controlledEntryRate =
    totalEntries > 0 ? (controlledEntries / totalEntries) * 100 : 0;

  const totalExits = exits.length;
  const successfulExits = exits.filter((e) => e.success).length;
  const exitSuccessRate = totalExits > 0 ? (successfulExits / totalExits) * 100 : 0;

  return {
    entries,
    exits,
    totalEntries,
    controlledEntries,
    dumpIns,
    controlledEntryRate: parseFloat(controlledEntryRate.toFixed(1)),
    successfulExits,
    totalExits,
    exitSuccessRate: parseFloat(exitSuccessRate.toFixed(1)),
  };
}
