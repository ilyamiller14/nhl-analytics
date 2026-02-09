/**
 * Movement Analytics Service
 *
 * "Ice Flow" Movement Pattern Intelligence system for coaching/management analytics.
 * Calculates movement fingerprints, formation deviations, team flow fields, and shift intensity.
 */

import { ZONES, COORDINATES, GOALS } from '../constants/rink';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Zone type for movement tracking
 */
export type MovementZone = 'offensive' | 'neutral' | 'defensive';

/**
 * Individual movement point in a skating path
 */
export interface MovementPoint {
  x: number;              // NHL coordinate (-100 to 100)
  y: number;              // NHL coordinate (-42.5 to 42.5)
  timestamp: number;      // Milliseconds into the shift
  speed: number;          // Feet per second
  direction: number;      // Radians (0 = right, PI/2 = up)
  zone: MovementZone;
}

/**
 * Complete skating trail for a player
 */
export interface SkatingTrail {
  playerId: number;
  playerName: string;
  shiftId: string;
  gameId: number;
  period: number;
  startTime: string;
  endTime: string;
  teamId: number;
  points: MovementPoint[];
  totalDistance: number;  // Feet
  avgSpeed: number;       // Feet per second
  maxSpeed: number;       // Feet per second
  zoneTime: {
    offensive: number;    // Milliseconds
    neutral: number;
    defensive: number;
  };
}

/**
 * Directional bucket for fingerprint (8 or 16 spokes)
 */
export interface DirectionalBucket {
  direction: number;      // Center angle in radians
  frequency: number;      // 0-1 normalized count
  avgSpeed: number;       // Average speed when moving this direction
  totalCount: number;     // Raw count
}

/**
 * Movement fingerprint showing directional skating tendencies
 */
export interface MovementFingerprint {
  playerId?: number;
  playerName?: string;
  teamId?: number;
  buckets: DirectionalBucket[];
  bucketCount: number;    // 8 or 16
  dominantDirection: number;
  avgOverallSpeed: number;
  totalSamples: number;
  gamesAnalyzed: number;
}

/**
 * Expected position for formation analysis
 */
export interface ExpectedPosition {
  playerId: number;
  playerName: string;
  position: string;       // C, LW, RW, LD, RD, G
  expectedX: number;
  expectedY: number;
  situation: string;      // 5v5, PP, PK, faceoff, breakout, forecheck
}

/**
 * Actual vs expected position comparison
 */
export interface PositionDeviation {
  playerId: number;
  playerName: string;
  position: string;
  actualX: number;
  actualY: number;
  expectedX: number;
  expectedY: number;
  deviationDistance: number;  // Feet
  deviationAngle: number;     // Radians from expected
  severity: 'green' | 'yellow' | 'red';  // <5ft, 5-10ft, >10ft
  timestamp: number;
}

/**
 * Formation snapshot at a point in time
 */
export interface FormationSnapshot {
  timestamp: number;
  period: number;
  timeInPeriod: string;
  situation: string;
  players: PositionDeviation[];
  teamDeviationAvg: number;
  isInPosition: boolean;  // All players within threshold
}

/**
 * Flow field cell for team movement vectors
 */
export interface FlowFieldCell {
  cellId: string;
  gridX: number;          // 0-9 (10 columns)
  gridY: number;          // 0-7 (8 rows)
  centerX: number;        // NHL coordinate
  centerY: number;        // NHL coordinate
  direction: number;      // Average direction in radians
  magnitude: number;      // 0-1 normalized intensity
  frequency: number;      // Number of movements through this cell
  avgSpeed: number;       // Average speed in this cell
  successRate: number;    // % of movements leading to positive outcome
}

/**
 * Team flow field showing movement tendencies across ice
 */
export interface TeamFlowField {
  teamId: number;
  teamAbbrev: string;
  cells: FlowFieldCell[];
  gridWidth: number;
  gridHeight: number;
  situation: string;      // 5v5, PP, PK, forecheck, breakout
  sampleSize: number;
  gamesAnalyzed: number;
}

/**
 * Game situation for filtering
 */
export type GameSituation = '5v5' | 'PP' | 'PK' | 'forecheck' | 'breakout' | 'all';

/**
 * Event marker on shift timeline
 */
export interface ShiftEvent {
  type: 'shot' | 'goal' | 'hit' | 'takeaway' | 'giveaway' | 'block' | 'faceoff';
  timestamp: number;      // Milliseconds into the shift
  x: number;
  y: number;
  description?: string;
}

/**
 * Individual shift data for intensity chart
 */
export interface ShiftData {
  shiftId: string;
  playerId: number;
  playerName: string;
  gameId: number;
  period: number;
  startTime: string;
  endTime: string;
  duration: number;       // Seconds
  intensity: number;      // 0-100 normalized (distance * avg speed)
  distance: number;       // Feet skated
  avgSpeed: number;       // Feet per second
  zoneBalance: number;    // -1 (all DZ) to +1 (all OZ)
  events: ShiftEvent[];
}

/**
 * Shift intensity summary for a game
 */
export interface ShiftIntensitySummary {
  playerId?: number;
  playerName?: string;
  gameId: number;
  shifts: ShiftData[];
  avgIntensity: number;
  totalDistance: number;
  totalTOI: number;       // Seconds
  ozTime: number;         // Percentage
  dzTime: number;         // Percentage
  eventsCount: {
    shots: number;
    goals: number;
    hits: number;
    takeaways: number;
    giveaways: number;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get zone from NHL coordinate
 */
export function getZoneFromCoord(x: number): MovementZone {
  if (x > ZONES.OFFENSIVE.MIN_X) return 'offensive';
  if (x < ZONES.DEFENSIVE.MAX_X) return 'defensive';
  return 'neutral';
}

/**
 * Calculate distance between two points (in feet)
 */
export function calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

/**
 * Calculate direction from one point to another (in radians)
 */
export function calculateDirection(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/**
 * Calculate speed between two points given timestamps
 */
export function calculateSpeed(
  x1: number, y1: number, t1: number,
  x2: number, y2: number, t2: number
): number {
  const distance = calculateDistance(x1, y1, x2, y2);
  const timeSeconds = (t2 - t1) / 1000;
  return timeSeconds > 0 ? distance / timeSeconds : 0;
}

/**
 * Normalize angle to 0-2PI range
 */
export function normalizeAngle(angle: number): number {
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  return angle;
}

/**
 * Get bucket index for direction (0 to bucketCount-1)
 */
export function getDirectionBucket(direction: number, bucketCount: number): number {
  const normalizedDir = normalizeAngle(direction);
  const bucketSize = (2 * Math.PI) / bucketCount;
  return Math.floor(normalizedDir / bucketSize) % bucketCount;
}

/**
 * Calculate circular mean of angles
 */
export function circularMean(angles: number[], weights?: number[]): number {
  let sinSum = 0;
  let cosSum = 0;
  const n = angles.length;

  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    sinSum += Math.sin(angles[i]) * w;
    cosSum += Math.cos(angles[i]) * w;
  }

  return Math.atan2(sinSum, cosSum);
}

/**
 * Get severity color based on deviation distance
 */
export function getDeviationSeverity(distance: number): 'green' | 'yellow' | 'red' {
  if (distance < 5) return 'green';
  if (distance < 10) return 'yellow';
  return 'red';
}

// ============================================================================
// MOVEMENT FINGERPRINT CALCULATIONS
// ============================================================================

/**
 * Calculate movement fingerprint from skating trails
 * Shows directional skating tendencies as a radial histogram
 */
export function calculateMovementFingerprint(
  trails: SkatingTrail[],
  options: {
    bucketCount?: 8 | 16;
    playerId?: number;
    teamId?: number;
    minSpeed?: number;  // Filter out stationary moments
  } = {}
): MovementFingerprint {
  const { bucketCount = 16, playerId, teamId, minSpeed = 2 } = options;

  // Initialize buckets
  const buckets: DirectionalBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const centerAngle = (i + 0.5) * (2 * Math.PI / bucketCount);
    buckets.push({
      direction: centerAngle,
      frequency: 0,
      avgSpeed: 0,
      totalCount: 0,
    });
  }

  let totalSamples = 0;
  let totalSpeedSum = 0;
  const gamesSet = new Set<number>();

  // Process all trails
  for (const trail of trails) {
    if (playerId && trail.playerId !== playerId) continue;
    if (teamId && trail.teamId !== teamId) continue;

    gamesSet.add(trail.gameId);

    // Process movement points
    for (let i = 1; i < trail.points.length; i++) {
      const point = trail.points[i];

      // Skip stationary or slow movements
      if (point.speed < minSpeed) continue;

      const bucketIdx = getDirectionBucket(point.direction, bucketCount);
      buckets[bucketIdx].totalCount++;
      buckets[bucketIdx].avgSpeed += point.speed;
      totalSamples++;
      totalSpeedSum += point.speed;
    }
  }

  // Calculate averages and normalize frequencies
  let maxCount = 0;
  for (const bucket of buckets) {
    if (bucket.totalCount > maxCount) maxCount = bucket.totalCount;
    if (bucket.totalCount > 0) {
      bucket.avgSpeed = bucket.avgSpeed / bucket.totalCount;
    }
  }

  // Normalize frequencies
  for (const bucket of buckets) {
    bucket.frequency = maxCount > 0 ? bucket.totalCount / maxCount : 0;
  }

  // Find dominant direction
  let dominantIdx = 0;
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].totalCount > buckets[dominantIdx].totalCount) {
      dominantIdx = i;
    }
  }

  // Get player name from first matching trail
  let playerName: string | undefined;
  if (playerId) {
    const matchingTrail = trails.find(t => t.playerId === playerId);
    playerName = matchingTrail?.playerName;
  }

  return {
    playerId,
    playerName,
    teamId,
    buckets,
    bucketCount,
    dominantDirection: buckets[dominantIdx].direction,
    avgOverallSpeed: totalSamples > 0 ? totalSpeedSum / totalSamples : 0,
    totalSamples,
    gamesAnalyzed: gamesSet.size,
  };
}

/**
 * Compare two fingerprints for similarity (0-100)
 */
export function compareFingerprints(fp1: MovementFingerprint, fp2: MovementFingerprint): number {
  if (fp1.bucketCount !== fp2.bucketCount) {
    throw new Error('Fingerprints must have same bucket count');
  }

  let similarity = 0;
  for (let i = 0; i < fp1.buckets.length; i++) {
    const diff = Math.abs(fp1.buckets[i].frequency - fp2.buckets[i].frequency);
    similarity += (1 - diff);
  }

  return (similarity / fp1.buckets.length) * 100;
}

// ============================================================================
// FORMATION DEVIATION CALCULATIONS
// ============================================================================

/**
 * Default expected positions by situation (NHL coordinates)
 * These are typical positional benchmarks for formation analysis
 */
export const EXPECTED_POSITIONS: Record<string, Record<string, { x: number; y: number }>> = {
  '5v5_neutral': {
    C: { x: 0, y: 0 },
    LW: { x: -10, y: -25 },
    RW: { x: -10, y: 25 },
    LD: { x: -40, y: -15 },
    RD: { x: -40, y: 15 },
  },
  '5v5_offensive': {
    C: { x: 70, y: 0 },
    LW: { x: 80, y: -20 },
    RW: { x: 80, y: 20 },
    LD: { x: 50, y: -25 },
    RD: { x: 50, y: 25 },
  },
  '5v5_defensive': {
    C: { x: -50, y: 0 },
    LW: { x: -45, y: -15 },
    RW: { x: -45, y: 15 },
    LD: { x: -70, y: -15 },
    RD: { x: -70, y: 15 },
  },
  breakout: {
    C: { x: -30, y: 0 },
    LW: { x: -20, y: -35 },
    RW: { x: -20, y: 35 },
    LD: { x: -75, y: -20 },
    RD: { x: -75, y: 20 },
  },
  forecheck_1_2_2: {
    C: { x: 75, y: 0 },      // F1 - first forechecker
    LW: { x: 55, y: -20 },   // F2 - support
    RW: { x: 55, y: 20 },    // F2 - support
    LD: { x: 30, y: -15 },
    RD: { x: 30, y: 15 },
  },
  PP_umbrella: {
    C: { x: 75, y: 0 },      // Net-front
    LW: { x: 65, y: -25 },   // Left circle
    RW: { x: 65, y: 25 },    // Right circle
    LD: { x: 50, y: -30 },   // Left point
    RD: { x: 50, y: 30 },    // Right point
  },
  PK_box: {
    C: { x: -65, y: -10 },   // Left forward
    LW: { x: -65, y: 10 },   // Right forward
    LD: { x: -80, y: -10 },  // Left D
    RD: { x: -80, y: 10 },   // Right D
  },
};

/**
 * Calculate formation deviation for a snapshot
 */
export function calculateFormationDeviation(
  actualPositions: Array<{
    playerId: number;
    playerName: string;
    position: string;
    x: number;
    y: number;
  }>,
  situation: string = '5v5_neutral'
): PositionDeviation[] {
  const expectedMap = EXPECTED_POSITIONS[situation] || EXPECTED_POSITIONS['5v5_neutral'];
  const deviations: PositionDeviation[] = [];

  for (const actual of actualPositions) {
    const expected = expectedMap[actual.position];
    if (!expected) continue;

    const distance = calculateDistance(actual.x, actual.y, expected.x, expected.y);
    const angle = calculateDirection(expected.x, expected.y, actual.x, actual.y);

    deviations.push({
      playerId: actual.playerId,
      playerName: actual.playerName,
      position: actual.position,
      actualX: actual.x,
      actualY: actual.y,
      expectedX: expected.x,
      expectedY: expected.y,
      deviationDistance: distance,
      deviationAngle: angle,
      severity: getDeviationSeverity(distance),
      timestamp: Date.now(),
    });
  }

  return deviations;
}

/**
 * Calculate team average deviation from formation
 */
export function calculateTeamFormationScore(deviations: PositionDeviation[]): number {
  if (deviations.length === 0) return 0;

  const totalDeviation = deviations.reduce((sum, d) => sum + d.deviationDistance, 0);
  const avgDeviation = totalDeviation / deviations.length;

  // Convert to 0-100 score (lower deviation = higher score)
  // Max expected deviation ~40 feet = score of 0
  // Perfect position = score of 100
  return Math.max(0, Math.min(100, 100 - (avgDeviation * 2.5)));
}

/**
 * Detect formation situation based on puck location and game state
 */
export function detectFormationSituation(
  puckX: number,
  puckY: number,
  strength: string = '5v5',
  possession: 'team' | 'opponent' | 'loose' = 'team'
): string {
  const zone = getZoneFromCoord(puckX);

  if (strength === 'PP') {
    return 'PP_umbrella';
  }
  if (strength === 'PK') {
    return 'PK_box';
  }

  if (zone === 'offensive' && possession === 'team') {
    return 'forecheck_1_2_2';
  }
  if (zone === 'defensive' && possession === 'team') {
    return 'breakout';
  }
  if (zone === 'defensive') {
    return '5v5_defensive';
  }
  if (zone === 'offensive') {
    return '5v5_offensive';
  }

  return '5v5_neutral';
}

// ============================================================================
// TEAM FLOW FIELD CALCULATIONS
// ============================================================================

/**
 * Calculate team flow field from movement data
 * Shows average movement direction and intensity at each ice location
 */
export function calculateTeamFlowField(
  trails: SkatingTrail[],
  options: {
    teamId: number;
    teamAbbrev: string;
    situation?: GameSituation;
    gridWidth?: number;
    gridHeight?: number;
  }
): TeamFlowField {
  const {
    teamId,
    teamAbbrev,
    situation = 'all',
    gridWidth = 10,
    gridHeight = 8,
  } = options;

  // Initialize grid cells
  const cells: FlowFieldCell[] = [];
  const cellWidth = (COORDINATES.MAX_X - COORDINATES.MIN_X) / gridWidth;  // 20 feet
  const cellHeight = (COORDINATES.MAX_Y - COORDINATES.MIN_Y) / gridHeight; // ~10.6 feet

  // Cell accumulator
  const cellData: Map<string, {
    directions: number[];
    speeds: number[];
    successCount: number;
  }> = new Map();

  // Initialize cells
  for (let gx = 0; gx < gridWidth; gx++) {
    for (let gy = 0; gy < gridHeight; gy++) {
      const cellId = `${gx}-${gy}`;
      cellData.set(cellId, {
        directions: [],
        speeds: [],
        successCount: 0,
      });
    }
  }

  const gamesSet = new Set<number>();

  // Process trails
  for (const trail of trails) {
    if (trail.teamId !== teamId) continue;
    gamesSet.add(trail.gameId);

    for (const point of trail.points) {
      // Convert to grid coordinates
      const gx = Math.floor((point.x - COORDINATES.MIN_X) / cellWidth);
      const gy = Math.floor((point.y - COORDINATES.MIN_Y) / cellHeight);

      if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight) continue;

      const cellId = `${gx}-${gy}`;
      const cell = cellData.get(cellId)!;

      cell.directions.push(point.direction);
      cell.speeds.push(point.speed);

      // Consider movement towards offensive zone as "successful"
      // Direction 0 = right = towards offensive zone
      if (Math.abs(point.direction) < Math.PI / 2) {
        cell.successCount++;
      }
    }
  }

  // Calculate final cell values
  let maxMagnitude = 0;

  for (let gx = 0; gx < gridWidth; gx++) {
    for (let gy = 0; gy < gridHeight; gy++) {
      const cellId = `${gx}-${gy}`;
      const data = cellData.get(cellId)!;

      const centerX = COORDINATES.MIN_X + (gx + 0.5) * cellWidth;
      const centerY = COORDINATES.MIN_Y + (gy + 0.5) * cellHeight;

      const frequency = data.directions.length;
      const avgDirection = frequency > 0 ? circularMean(data.directions) : 0;
      const avgSpeed = frequency > 0
        ? data.speeds.reduce((a, b) => a + b, 0) / frequency
        : 0;
      const successRate = frequency > 0 ? data.successCount / frequency : 0;

      if (frequency > maxMagnitude) maxMagnitude = frequency;

      cells.push({
        cellId,
        gridX: gx,
        gridY: gy,
        centerX,
        centerY,
        direction: avgDirection,
        magnitude: frequency,  // Will normalize after
        frequency,
        avgSpeed,
        successRate,
      });
    }
  }

  // Normalize magnitudes
  for (const cell of cells) {
    cell.magnitude = maxMagnitude > 0 ? cell.frequency / maxMagnitude : 0;
  }

  return {
    teamId,
    teamAbbrev,
    cells,
    gridWidth,
    gridHeight,
    situation,
    sampleSize: trails.filter(t => t.teamId === teamId).length,
    gamesAnalyzed: gamesSet.size,
  };
}

/**
 * Filter flow field by situation type
 */
export function filterFlowFieldBySituation(
  flowField: TeamFlowField,
  situation: GameSituation
): TeamFlowField {
  // In real implementation, this would filter based on game state
  // For now, return the same flow field with updated situation label
  return {
    ...flowField,
    situation,
  };
}

// ============================================================================
// SHIFT INTENSITY CALCULATIONS
// ============================================================================

/**
 * Calculate intensity score for a shift
 * Intensity = normalized(distance * avg_speed)
 */
export function calculateShiftIntensity(
  distance: number,
  avgSpeed: number,
  duration: number
): number {
  // Expected values for normalization
  // Top players: ~500ft per minute at ~15 ft/s
  // Average: ~350ft per minute at ~12 ft/s
  const maxExpectedDistance = 1000;  // Feet for a long shift
  const maxExpectedSpeed = 25;       // ft/s (elite speed)

  const normalizedDistance = Math.min(distance / maxExpectedDistance, 1);
  const normalizedSpeed = Math.min(avgSpeed / maxExpectedSpeed, 1);

  // Combined intensity (weighted towards distance)
  return Math.round((normalizedDistance * 0.6 + normalizedSpeed * 0.4) * 100);
}

/**
 * Calculate zone balance for a shift
 * Returns -1 (all DZ) to +1 (all OZ)
 */
export function calculateZoneBalance(zoneTime: {
  offensive: number;
  neutral: number;
  defensive: number;
}): number {
  const total = zoneTime.offensive + zoneTime.neutral + zoneTime.defensive;
  if (total === 0) return 0;

  const ozPct = zoneTime.offensive / total;
  const dzPct = zoneTime.defensive / total;

  return ozPct - dzPct;
}

/**
 * Process skating trail into shift data
 */
export function processTrailToShift(
  trail: SkatingTrail,
  events: ShiftEvent[] = []
): ShiftData {
  const zoneBalance = calculateZoneBalance(trail.zoneTime);
  const intensity = calculateShiftIntensity(
    trail.totalDistance,
    trail.avgSpeed,
    trail.points.length > 0
      ? (trail.points[trail.points.length - 1].timestamp - trail.points[0].timestamp) / 1000
      : 0
  );

  // Parse duration from time strings
  const parseTimeToSeconds = (time: string): number => {
    const [min, sec] = time.split(':').map(Number);
    return min * 60 + sec;
  };

  const startSeconds = parseTimeToSeconds(trail.startTime);
  const endSeconds = parseTimeToSeconds(trail.endTime);
  const duration = Math.abs(endSeconds - startSeconds);

  return {
    shiftId: trail.shiftId,
    playerId: trail.playerId,
    playerName: trail.playerName,
    gameId: trail.gameId,
    period: trail.period,
    startTime: trail.startTime,
    endTime: trail.endTime,
    duration,
    intensity,
    distance: trail.totalDistance,
    avgSpeed: trail.avgSpeed,
    zoneBalance,
    events,
  };
}

/**
 * Calculate shift intensity summary for a game
 */
export function calculateShiftIntensitySummary(
  shifts: ShiftData[],
  options: { playerId?: number; gameId: number }
): ShiftIntensitySummary {
  const { playerId, gameId } = options;

  const filteredShifts = playerId
    ? shifts.filter(s => s.playerId === playerId && s.gameId === gameId)
    : shifts.filter(s => s.gameId === gameId);

  if (filteredShifts.length === 0) {
    return {
      playerId,
      gameId,
      shifts: [],
      avgIntensity: 0,
      totalDistance: 0,
      totalTOI: 0,
      ozTime: 0,
      dzTime: 0,
      eventsCount: { shots: 0, goals: 0, hits: 0, takeaways: 0, giveaways: 0 },
    };
  }

  const totalIntensity = filteredShifts.reduce((sum, s) => sum + s.intensity, 0);
  const totalDistance = filteredShifts.reduce((sum, s) => sum + s.distance, 0);
  const totalTOI = filteredShifts.reduce((sum, s) => sum + s.duration, 0);

  // Calculate zone time percentages
  const positiveBalance = filteredShifts.filter(s => s.zoneBalance > 0);
  const negativeBalance = filteredShifts.filter(s => s.zoneBalance < 0);
  const ozTime = (positiveBalance.length / filteredShifts.length) * 100;
  const dzTime = (negativeBalance.length / filteredShifts.length) * 100;

  // Count events
  const allEvents = filteredShifts.flatMap(s => s.events);
  const eventsCount = {
    shots: allEvents.filter(e => e.type === 'shot').length,
    goals: allEvents.filter(e => e.type === 'goal').length,
    hits: allEvents.filter(e => e.type === 'hit').length,
    takeaways: allEvents.filter(e => e.type === 'takeaway').length,
    giveaways: allEvents.filter(e => e.type === 'giveaway').length,
  };

  // Get player name from first shift
  const playerName = playerId ? filteredShifts[0]?.playerName : undefined;

  return {
    playerId,
    playerName,
    gameId,
    shifts: filteredShifts,
    avgIntensity: totalIntensity / filteredShifts.length,
    totalDistance,
    totalTOI,
    ozTime,
    dzTime,
    eventsCount,
  };
}

// ============================================================================
// MOCK DATA GENERATORS (for demo/development)
// ============================================================================

/**
 * Generate mock skating trail data
 */
export function generateMockSkatingTrail(
  playerId: number,
  playerName: string,
  gameId: number,
  options: {
    period?: number;
    teamId?: number;
    duration?: number;  // seconds
  } = {}
): SkatingTrail {
  const { period = 1, teamId = 1, duration = 45 } = options;

  const points: MovementPoint[] = [];
  const numPoints = Math.floor(duration * 2);  // ~2 points per second

  let x = Math.random() * 60 - 30;  // Start near center
  let y = Math.random() * 40 - 20;

  const zoneTime = { offensive: 0, neutral: 0, defensive: 0 };
  let totalDistance = 0;
  let maxSpeed = 0;

  for (let i = 0; i < numPoints; i++) {
    const timestamp = i * 500;  // 500ms intervals

    // Random movement with bias towards offensive zone
    const directionBias = Math.random() * 0.4;  // Slight forward bias
    const direction = (Math.random() * 2 * Math.PI) + directionBias;
    const speed = 8 + Math.random() * 10;  // 8-18 ft/s

    // Move
    const dx = Math.cos(direction) * speed * 0.5;
    const dy = Math.sin(direction) * speed * 0.5;
    x = Math.max(-95, Math.min(95, x + dx));
    y = Math.max(-40, Math.min(40, y + dy));

    const zone = getZoneFromCoord(x);
    zoneTime[zone] += 500;

    if (i > 0) {
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }
    if (speed > maxSpeed) maxSpeed = speed;

    points.push({
      x,
      y,
      timestamp,
      speed,
      direction,
      zone,
    });
  }

  const avgSpeed = points.reduce((sum, p) => sum + p.speed, 0) / points.length;

  return {
    playerId,
    playerName,
    shiftId: `${gameId}-${period}-${playerId}-${Date.now()}`,
    gameId,
    period,
    startTime: `${Math.floor(Math.random() * 19)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
    endTime: `${Math.floor(Math.random() * 19)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`,
    teamId,
    points,
    totalDistance,
    avgSpeed,
    maxSpeed,
    zoneTime,
  };
}

/**
 * Generate mock fingerprint data
 */
export function generateMockFingerprint(
  options: {
    playerId?: number;
    playerName?: string;
    teamId?: number;
    bucketCount?: 8 | 16;
    style?: 'rush' | 'cycle' | 'balanced';
  } = {}
): MovementFingerprint {
  const {
    playerId,
    playerName,
    teamId,
    bucketCount = 16,
    style = 'balanced',
  } = options;

  const buckets: DirectionalBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const centerAngle = (i + 0.5) * (2 * Math.PI / bucketCount);

    // Style affects distribution
    let baseProbability = 0.5;
    if (style === 'rush') {
      // More forward movement (direction ~0)
      baseProbability = Math.cos(centerAngle) > 0 ? 0.7 : 0.3;
    } else if (style === 'cycle') {
      // More lateral movement
      baseProbability = Math.abs(Math.sin(centerAngle)) > 0.5 ? 0.7 : 0.4;
    }

    const frequency = baseProbability + Math.random() * 0.3;
    const avgSpeed = 10 + Math.random() * 8;
    const totalCount = Math.floor(frequency * 100);

    buckets.push({
      direction: centerAngle,
      frequency,
      avgSpeed,
      totalCount,
    });
  }

  // Normalize frequencies
  const maxFreq = Math.max(...buckets.map(b => b.frequency));
  for (const bucket of buckets) {
    bucket.frequency = bucket.frequency / maxFreq;
  }

  // Find dominant direction
  let dominantIdx = 0;
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].totalCount > buckets[dominantIdx].totalCount) {
      dominantIdx = i;
    }
  }

  return {
    playerId,
    playerName,
    teamId,
    buckets,
    bucketCount,
    dominantDirection: buckets[dominantIdx].direction,
    avgOverallSpeed: 14,
    totalSamples: buckets.reduce((sum, b) => sum + b.totalCount, 0),
    gamesAnalyzed: 10,
  };
}

/**
 * Generate mock flow field data
 */
export function generateMockFlowField(
  teamId: number,
  teamAbbrev: string,
  situation: GameSituation = 'all'
): TeamFlowField {
  const gridWidth = 10;
  const gridHeight = 8;
  const cells: FlowFieldCell[] = [];

  const cellWidth = 200 / gridWidth;
  const cellHeight = 85 / gridHeight;

  for (let gx = 0; gx < gridWidth; gx++) {
    for (let gy = 0; gy < gridHeight; gy++) {
      const centerX = -100 + (gx + 0.5) * cellWidth;
      const centerY = -42.5 + (gy + 0.5) * cellHeight;

      // Direction bias based on position (generally towards goal)
      const goalX = 89;
      const baseDirection = Math.atan2(0 - centerY, goalX - centerX);
      const direction = baseDirection + (Math.random() - 0.5) * 0.5;

      // Magnitude higher in transition areas
      const distFromCenter = Math.abs(centerX);
      const magnitude = 0.3 + Math.random() * 0.5 + (distFromCenter < 30 ? 0.2 : 0);

      const frequency = Math.floor(magnitude * 50);
      const avgSpeed = 10 + Math.random() * 8;
      const successRate = 0.4 + Math.random() * 0.4;

      cells.push({
        cellId: `${gx}-${gy}`,
        gridX: gx,
        gridY: gy,
        centerX,
        centerY,
        direction,
        magnitude,
        frequency,
        avgSpeed,
        successRate,
      });
    }
  }

  return {
    teamId,
    teamAbbrev,
    cells,
    gridWidth,
    gridHeight,
    situation,
    sampleSize: 500,
    gamesAnalyzed: 15,
  };
}

/**
 * Generate mock shift data for a game
 */
export function generateMockShiftData(
  gameId: number,
  playerId: number,
  playerName: string,
  numShifts: number = 20
): ShiftData[] {
  const shifts: ShiftData[] = [];

  for (let i = 0; i < numShifts; i++) {
    const period = Math.floor(i / (numShifts / 3)) + 1;
    const duration = 30 + Math.random() * 40;  // 30-70 seconds
    const distance = duration * (10 + Math.random() * 5);  // ~10-15 ft/s
    const avgSpeed = distance / duration;

    const zoneBalance = Math.random() * 2 - 1;  // -1 to +1
    const intensity = calculateShiftIntensity(distance, avgSpeed, duration);

    // Generate random events
    const events: ShiftEvent[] = [];
    const numEvents = Math.floor(Math.random() * 4);
    const eventTypes: ShiftEvent['type'][] = ['shot', 'hit', 'takeaway', 'giveaway', 'block'];

    for (let j = 0; j < numEvents; j++) {
      events.push({
        type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
        timestamp: Math.random() * duration * 1000,
        x: Math.random() * 200 - 100,
        y: Math.random() * 85 - 42.5,
      });
    }

    // Occasionally add a goal
    if (Math.random() < 0.05) {
      events.push({
        type: 'goal',
        timestamp: Math.random() * duration * 1000,
        x: 85 + Math.random() * 10,
        y: Math.random() * 20 - 10,
        description: 'Goal!',
      });
    }

    const startMin = Math.floor(20 - (20 / (numShifts / 3)) * (i % (numShifts / 3)));
    const startSec = Math.floor(Math.random() * 60);

    shifts.push({
      shiftId: `${gameId}-${period}-${playerId}-${i}`,
      playerId,
      playerName,
      gameId,
      period,
      startTime: `${startMin}:${String(startSec).padStart(2, '0')}`,
      endTime: `${Math.max(0, startMin - Math.floor(duration / 60))}:${String(Math.floor((60 + startSec - (duration % 60)) % 60)).padStart(2, '0')}`,
      duration,
      intensity,
      distance,
      avgSpeed,
      zoneBalance,
      events,
    });
  }

  return shifts;
}

/**
 * Generate mock position data for formation ghost chart
 */
export function generateMockPositionData(
  situation: string = '5v5_neutral'
): Array<{
  playerId: number;
  playerName: string;
  position: string;
  x: number;
  y: number;
}> {
  const positions = ['C', 'LW', 'RW', 'LD', 'RD'];
  const names = ['Center Player', 'Left Wing', 'Right Wing', 'Left Defense', 'Right Defense'];
  const expected = EXPECTED_POSITIONS[situation] || EXPECTED_POSITIONS['5v5_neutral'];

  return positions.map((pos, i) => {
    const expectedPos = expected[pos];
    // Add some deviation from expected
    const deviationX = (Math.random() - 0.5) * 20;
    const deviationY = (Math.random() - 0.5) * 15;

    return {
      playerId: 1000 + i,
      playerName: names[i],
      position: pos,
      x: expectedPos.x + deviationX,
      y: expectedPos.y + deviationY,
    };
  });
}
