/**
 * Play Style Types for Attack DNA Visualization
 *
 * Defines types for:
 * - Attack sequences (play-by-play chains ending in shots)
 * - Play archetypes (rush, cycle, point shot, etc.)
 * - Flow field vectors (directional movement on ice)
 * - Attack ribbons (Sankey-style paths)
 * - Fingerprint metrics (6-axis radar chart)
 */

// ============================================================================
// PLAY ARCHETYPES
// ============================================================================

/**
 * 11 distinct play archetypes based on how attacks develop
 */
export type PlayArchetype =
  | 'rush-breakaway'      // Isolated 1-on-0/1-on-1 from deep D-zone
  | 'rush-oddman'         // Odd-man rush (2v1, 3v2) with numerical advantage
  | 'rush-standard'       // Quick transition with defensive pressure
  | 'cycle-low'           // Sustained O-zone, shot from boards/corners
  | 'cycle-high'          // Sustained O-zone, shot from slot area
  | 'point-shot'          // Shot from blue line area
  | 'point-deflection'    // Point shot with tip/deflection
  | 'net-scramble'        // Chaos in front of net, sustained pressure
  | 'rebound'             // Quick shot after prior shot (< 3s)
  | 'transition-quick'    // D-zone to shot in < 5s
  | 'transition-sustained'; // D-zone to shot in 5-10s

/**
 * High-level team style categories
 */
export type PlayStyleCategory =
  | 'Rush Team'
  | 'Cycle Team'
  | 'Point Shot Team'
  | 'Net-Front Team'
  | 'Transition Team'
  | 'Balanced';

// ============================================================================
// ATTACK SEQUENCES
// ============================================================================

/**
 * A waypoint in an attack sequence
 */
export interface AttackWaypoint {
  xCoord: number;
  yCoord: number;
  eventType: string;
  timeInPeriod: string;
}

/**
 * Origin of an attack sequence
 */
export interface AttackOrigin {
  zone: 'defensive' | 'neutral' | 'offensive';
  xCoord: number;
  yCoord: number;
  triggerEvent: 'faceoff' | 'takeaway' | 'blocked-shot' | 'rebound' | 'breakout';
}

/**
 * Zone entry during attack sequence
 */
export interface AttackZoneEntry {
  type: 'controlled' | 'dump' | 'pass';
  xCoord: number;
  yCoord: number;
  success: boolean;
}

/**
 * Outcome of an attack sequence
 */
export interface AttackOutcome {
  type: 'shot' | 'turnover' | 'penalty' | 'offside' | 'icing';
  shotResult?: 'goal' | 'save' | 'miss' | 'block';
  xCoord?: number;
  yCoord?: number;
  xG?: number;
}

/**
 * Complete attack sequence from origin to outcome
 */
export interface AttackSequence {
  sequenceId: string;
  teamId: number;
  playerId?: number;

  // Timing
  period: number;
  startTime: string;
  endTime: string;
  durationSeconds: number;

  // Path
  origin: AttackOrigin;
  waypoints: AttackWaypoint[];
  zoneEntry?: AttackZoneEntry;
  outcome: AttackOutcome;

  // Classification
  archetype: PlayArchetype;
  transitionTime: number;
}

// ============================================================================
// FLOW FIELD (VECTOR ARROWS)
// ============================================================================

/**
 * Single cell in the flow field grid
 */
export interface FlowFieldCell {
  cellId: string;
  gridX: number;           // 0-9 (10 columns)
  gridY: number;           // 0-7 (8 rows)
  centerX: number;         // NHL coordinate
  centerY: number;         // NHL coordinate

  // Vector data
  direction: number;       // Angle in radians (0 = right, PI/2 = up)
  magnitude: number;       // 0-1 normalized frequency
  successRate: number;     // 0-1 success rate

  // Event counts
  eventCount: number;
  shotCount: number;
  passCount: number;
  turnoverCount: number;
}

/**
 * Complete flow field for ice surface
 */
export interface FlowField {
  cells: FlowFieldCell[];
  gridWidth: number;       // 10
  gridHeight: number;      // 8
  teamId: number;
  playerId?: number;
  sampleSize: number;      // Number of sequences analyzed
}

// ============================================================================
// ATTACK RIBBONS (SANKEY-STYLE PATHS)
// ============================================================================

/**
 * Bezier control points for ribbon path
 */
export interface RibbonPath {
  start: { x: number; y: number };
  control1: { x: number; y: number };
  control2: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Attack ribbon representing aggregated paths of an archetype
 */
export interface AttackRibbon {
  ribbonId: string;
  archetype: PlayArchetype;

  // Path definition
  path: RibbonPath;

  // Visual properties
  width: number;           // Proportional to frequency
  opacity: number;

  // Statistics
  frequency: number;       // Raw count
  percentage: number;      // Of total attacks
  conversionRate: number;  // Goals per attack (%)
  avgXG: number;
}

// ============================================================================
// FINGERPRINT (6-AXIS RADAR)
// ============================================================================

/**
 * Deviation from league average for comparison
 */
export interface FingerprintDeviation {
  rushTendency: number;
  cycleTendency: number;
  pointShotFocus: number;
  netFrontPresence: number;
  transitionSpeed: number;
  entryAggression: number;
}

/**
 * Play style fingerprint - 6-axis metrics defining attack identity
 */
export interface PlayStyleFingerprint {
  teamId: number;
  playerId?: number;
  sampleGames: number;

  // Six-axis metrics (all 0-100)
  rushTendency: number;        // % of attacks via rush
  cycleTendency: number;       // % with sustained O-zone time
  pointShotFocus: number;      // % from blue line
  netFrontPresence: number;    // % from crease/slot
  transitionSpeed: number;     // Inverted avg transition time
  entryAggression: number;     // Controlled entry rate

  // Classification
  primaryStyle: PlayStyleCategory;
  secondaryStyle?: PlayStyleCategory;
  styleStrength: number;       // How distinct (0-100)

  // Archetype breakdown
  archetypeDistribution: Record<PlayArchetype, number>;

  // Comparison to league average
  deviationFromAverage: FingerprintDeviation;
}

// ============================================================================
// COMBINED ANALYTICS OUTPUT
// ============================================================================

/**
 * Period-level breakdown of attack patterns
 */
export interface PeriodBreakdown {
  period: number;
  attacks: number;
  primaryArchetype: PlayArchetype;
  xG: number;
  goals: number;
}

/**
 * Complete Attack DNA analytics output
 */
export interface AttackDNAAnalytics {
  fingerprint: PlayStyleFingerprint;
  flowField: FlowField;
  ribbons: AttackRibbon[];
  sequences: AttackSequence[];

  // Summary stats
  totalAttacks: number;
  goalsScored: number;
  totalXG: number;
  conversionRate: number;
  avgTransitionTime: number;

  // Temporal patterns
  periodBreakdown: PeriodBreakdown[];
}

// ============================================================================
// COMPARISON MODE
// ============================================================================

/**
 * Comparison type for overlay views
 */
export type ComparisonType =
  | 'vs-league-average'
  | 'vs-opponent'
  | 'player-vs-team';

/**
 * Comparison data for overlay visualization
 */
export interface AttackDNAComparison {
  type: ComparisonType;
  primary: AttackDNAAnalytics;
  comparison: AttackDNAAnalytics;
  label: string;           // e.g., "League Average", "Boston Bruins"
}

// ============================================================================
// ARCHETYPE COLORS (for visualization)
// ============================================================================

/**
 * Color mapping for archetypes
 */
export const ARCHETYPE_COLORS: Record<PlayArchetype, string> = {
  'rush-breakaway': '#ef4444',     // Red
  'rush-oddman': '#f97316',        // Orange
  'rush-standard': '#fb923c',      // Light orange
  'cycle-low': '#3b82f6',          // Blue
  'cycle-high': '#60a5fa',         // Light blue
  'point-shot': '#a855f7',         // Purple
  'point-deflection': '#c084fc',   // Light purple
  'net-scramble': '#22c55e',       // Green
  'rebound': '#4ade80',            // Light green
  'transition-quick': '#eab308',   // Yellow
  'transition-sustained': '#facc15', // Light yellow
};

/**
 * Grouped archetype colors (for simplified view)
 */
export const ARCHETYPE_GROUP_COLORS = {
  rush: '#ef4444',       // Red
  cycle: '#3b82f6',      // Blue
  point: '#a855f7',      // Purple
  netFront: '#22c55e',   // Green
  transition: '#eab308', // Yellow
};

/**
 * Map archetype to group
 */
export function getArchetypeGroup(archetype: PlayArchetype): keyof typeof ARCHETYPE_GROUP_COLORS {
  if (archetype.startsWith('rush-')) return 'rush';
  if (archetype.startsWith('cycle-')) return 'cycle';
  if (archetype.startsWith('point-')) return 'point';
  if (archetype === 'net-scramble' || archetype === 'rebound') return 'netFront';
  return 'transition';
}

// ============================================================================
// NEW REDESIGNED TYPES (First-Principles Approach)
// ============================================================================

/**
 * Individual shot location for scatter plot visualization
 */
export interface ShotLocation {
  x: number;              // NHL coordinate (-100 to 100)
  y: number;              // NHL coordinate (-42.5 to 42.5)
  result: 'goal' | 'save' | 'miss' | 'block';
  xG?: number;
  shotType?: string;
  playerId?: number;
  gameId: number;
  gameDate: string;
  period: number;
  timeInPeriod: string;
  distanceFromGoal: number;
  isHighDanger: boolean;
}

/**
 * Shot density cell for heat map visualization
 */
export interface ShotDensityCell {
  gridX: number;          // 0-4 for half-rink (5 columns)
  gridY: number;          // 0-7 (8 rows)
  centerX: number;        // NHL coordinate
  centerY: number;        // NHL coordinate
  shotCount: number;      // Total shots
  goalCount: number;      // Goals scored
  avgXG: number;          // Average xG
  shotPct: number;        // Shooting percentage
  density: number;        // 0-1 normalized (vs max cell)
}

/**
 * Shot density map for heat visualization
 */
export interface ShotDensityMap {
  cells: ShotDensityCell[];
  gridWidth: number;      // 5 for half-rink
  gridHeight: number;     // 8
  totalShots: number;
  maxDensity: number;     // Max shots in any cell
}

/**
 * Zone classification for shot distribution
 */
export type ShotZone = 'high-slot' | 'low-slot' | 'point' | 'left-boards' | 'right-boards' | 'behind-net';

/**
 * Shot zone distribution for bar chart
 */
export interface ShotZoneDistribution {
  zone: ShotZone;
  shotCount: number;
  goalCount: number;
  percentage: number;     // % of total shots
  leagueAvgPct: number;   // League average for comparison
  deviation: number;      // +/- from league average
}

/**
 * Direct attack metrics (non-circular, directly measurable)
 */
export interface AttackMetrics {
  // Shot location metrics
  highDangerShotPct: number;    // % shots from slot/crease
  avgShotDistance: number;      // Average feet from net

  // Timing metrics
  avgTimeToShot: number;        // Avg seconds from zone entry to shot

  // Outcome metrics
  shootingPct: number;          // Goals / Shots on Goal (standard hockey stat)
  shotEfficiency: number;       // Goals / All Shot Attempts (includes misses/blocks)
}

/**
 * Simplified 4-axis radar fingerprint
 */
export interface AttackProfile {
  teamId: number;
  playerId?: number;
  sampleGames: number;

  // Four axes (all 0-100, centered at 50 = league average)
  dangerZoneFocus: number;      // High-danger shot % (normalized)
  attackSpeed: number;          // Inverted time-to-shot (faster = higher)
  shootingAccuracy: number;     // Shooting % (normalized)
  shootingDepth: number;        // Inverted shot distance (closer = higher)

  // Classification
  primaryStyle: 'Speed' | 'Cycle' | 'Perimeter' | 'Slot-Focused' | 'Balanced';
  styleStrength: number;        // 0-100 how distinct
}

/**
 * Game-level metrics for trend analysis
 */
export interface GameMetrics {
  gameId: number;
  gameDate: string;
  opponent: string;
  isHome: boolean;

  // Direct metrics
  totalShots: number;
  goals: number;
  highDangerShots: number;
  avgShotDistance: number;
  avgTimeToShot: number;
  // Derived
  highDangerPct: number;
  shootingPct: number;
}

/**
 * Rolling window for trend analysis
 */
export interface TrendWindow {
  startDate: string;
  endDate: string;
  gameCount: number;

  // Aggregated metrics
  highDangerPct: number;
  avgTimeToShot: number;
  avgShotDistance: number;
  shootingPct: number;

  // Shot distribution
  slotPct: number;
  pointPct: number;
  boardsPct: number;
}

/**
 * Inflection point in trends
 */
export interface InflectionPoint {
  date: string;
  metric: string;
  change: number;         // % change
  direction: 'up' | 'down';
  possibleCause?: string; // "Trade", "Injury", etc.
}

/**
 * Season trend analysis
 */
export interface SeasonTrend {
  teamId: number;
  season: string;

  // Per-game metrics
  gameMetrics: GameMetrics[];

  // Rolling averages
  windows: TrendWindow[];

  // Significant changes
  inflectionPoints: InflectionPoint[];
}

/**
 * Complete redesigned Attack DNA output
 */
export interface AttackDNAv2 {
  // Core data
  shots: ShotLocation[];
  densityMap: ShotDensityMap;
  zoneDistribution: ShotZoneDistribution[];

  // Metrics
  metrics: AttackMetrics;
  profile: AttackProfile;

  // Summary
  totalShots: number;
  totalGoals: number;
  gamesAnalyzed: number;

  // Trends (optional - loaded separately)
  seasonTrend?: SeasonTrend;
}

/**
 * Zone classification constants
 */
export const SHOT_ZONE_COLORS: Record<ShotZone, string> = {
  'high-slot': '#ef4444',      // Red - highest danger
  'low-slot': '#f97316',       // Orange - high danger
  'point': '#a855f7',          // Purple
  'left-boards': '#3b82f6',    // Blue
  'right-boards': '#60a5fa',   // Light blue
  'behind-net': '#6b7280',     // Gray
};

/**
 * League average values for comparison (can be updated with real data)
 */
export const LEAGUE_AVERAGES_V2 = {
  // Zone distribution (used for bar chart reference lines)
  zoneDistribution: {
    'high-slot': 22,
    'low-slot': 18,
    'point': 25,
    'left-boards': 15,
    'right-boards': 15,
    'behind-net': 5,
  } as Record<ShotZone, number>,
};
