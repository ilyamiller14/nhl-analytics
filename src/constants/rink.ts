/**
 * NHL Rink Constants
 *
 * Centralized definitions for rink dimensions, zones, and coordinates.
 * All values based on NHL regulation rink (200 ft x 85 ft)
 */

// Rink Dimensions (in feet)
export const RINK = {
  LENGTH: 200,
  WIDTH: 85,
  CORNER_RADIUS: 28,
  GOAL_LINE_DISTANCE: 11, // From end boards
} as const;

// Coordinate System
// NHL API uses: x: -100 to 100, y: -42.5 to 42.5
// Center ice is (0, 0), rink is 200ft x 85ft
export const COORDINATES = {
  MIN_X: -100,
  MAX_X: 100,
  MIN_Y: -42.5,
  MAX_Y: 42.5,
  CENTER_X: 0,
  CENTER_Y: 0,
} as const;

// Zone Boundaries (in coordinate system)
export const ZONES = {
  // Defensive zone: x < -25 (from center)
  DEFENSIVE: {
    MIN_X: -100,
    MAX_X: -25,
  },
  // Neutral zone: -25 <= x <= 25
  NEUTRAL: {
    MIN_X: -25,
    MAX_X: 25,
  },
  // Offensive zone: x > 25
  OFFENSIVE: {
    MIN_X: 25,
    MAX_X: 100,
  },
} as const;

// Normalized zone boundaries (0-100 scale for visualizations)
export const ZONES_NORMALIZED = {
  DEFENSIVE: { MIN: 0, MAX: 37.5 },    // 0-37.5%
  NEUTRAL: { MIN: 37.5, MAX: 62.5 },   // 37.5-62.5%
  OFFENSIVE: { MIN: 62.5, MAX: 100 },  // 62.5-100%
} as const;

// Blue line positions
export const BLUE_LINES = {
  // Distance from center in feet
  DISTANCE_FROM_CENTER: 25,
  // In coordinate system
  HOME_BLUE_LINE: -25,
  AWAY_BLUE_LINE: 25,
} as const;

// Goal positions
export const GOALS = {
  HOME: {
    X: -89,
    Y: 0,
  },
  AWAY: {
    X: 89,
    Y: 0,
  },
} as const;

// Slot Definition (high danger area)
export const SLOT = {
  // X range (distance from goal line)
  MIN_X: 69,  // ~20 feet from goal
  MAX_X: 89,  // At goal line
  // Y range (center of ice)
  MIN_Y: -10,
  MAX_Y: 10,
  // In normalized coordinates
  NORMALIZED: {
    MIN_X: 0.69,
    MAX_X: 0.89,
    MIN_Y: 0.382,  // (42.5-10)/85 ≈ 0.382
    MAX_Y: 0.618,  // (42.5+10)/85 ≈ 0.618
  },
} as const;

// Crease and inner slot (very high danger)
export const CREASE = {
  CENTER_X: 89,
  CENTER_Y: 0,
  RADIUS: 6, // Feet
} as const;

// Faceoff circles
export const FACEOFF_CIRCLES = {
  RADIUS: 15, // Feet
  POSITIONS: [
    { x: -69, y: 22, zone: 'defensive' },   // Home D-zone left
    { x: -69, y: -22, zone: 'defensive' },  // Home D-zone right
    { x: 69, y: 22, zone: 'offensive' },    // Away D-zone left
    { x: 69, y: -22, zone: 'offensive' },   // Away D-zone right
    { x: 0, y: 0, zone: 'neutral' },        // Center ice
  ],
} as const;

// Danger Zone Thresholds (based on distance from net)
export const DANGER_ZONES = {
  HIGH_DANGER: {
    MAX_DISTANCE: 20,  // Within 20 feet
    MAX_ANGLE: 45,     // Within 45 degrees of center
  },
  MEDIUM_DANGER: {
    MAX_DISTANCE: 35,
    MAX_ANGLE: 60,
  },
  // Beyond these = low danger
} as const;

// Shot Quality Thresholds (xG values)
export const XG_THRESHOLDS = {
  HIGH_DANGER: 0.15,     // >= 15% xG
  MEDIUM_DANGER: 0.08,   // >= 8% xG
  LOW_DANGER: 0,         // < 8% xG
  MAX_REASONABLE: 0.60,  // Cap at 60%
  MIN_REASONABLE: 0.005, // Floor at 0.5%
} as const;

// Time Constants
export const TIME = {
  PERIOD_LENGTH_SECONDS: 1200,  // 20 minutes
  OVERTIME_LENGTH_SECONDS: 300, // 5 minutes
  SHOOTOUT_MAX_ROUNDS: 10,
} as const;

// Momentum Tracking
export const MOMENTUM = {
  WINDOW_SECONDS: 120,      // 2-minute rolling window
  SAMPLE_INTERVAL: 30,      // Sample every 30 seconds
  SWING_THRESHOLD: 0.4,     // Significant momentum change
} as const;

// Rush Detection
export const RUSH = {
  MAX_TRANSITION_TIME: 10,  // Seconds from D-zone to shot
  BREAKAWAY_DEFENDER_COUNT: 0,
  ODD_MAN_RUSH_DEFENDER_COUNT: 1,
} as const;

// Breakout Classification
export const BREAKOUT = {
  D_TO_D: {
    MAX_VERTICAL: 10,      // Pass stays within 10 feet vertically
    MIN_HORIZONTAL: 15,    // At least 15 feet horizontal
  },
  STRETCH: {
    MIN_VERTICAL: 40,      // Long vertical pass
  },
  REVERSE: {
    MAX_VERTICAL: 0,       // Backward pass
  },
  RIM: {
    MIN_HORIZONTAL: 20,    // Along boards
    BOARD_Y_THRESHOLD: 35, // Near boards
  },
} as const;

// Royal Road Pass
export const ROYAL_ROAD = {
  MIN_HORIZONTAL_DISTANCE: 20,  // Cross-ice distance in feet
  MIN_X_FOR_SLOT: 69,           // Must end in slot area
} as const;

// Visualization Colors
export const COLORS = {
  DANGER: {
    HIGH: '#ef4444',      // Red
    MEDIUM: '#f59e0b',    // Orange/Yellow
    LOW: '#3b82f6',       // Blue
  },
  MOMENTUM: {
    HOME: '#10b981',      // Green
    AWAY: '#ef4444',      // Red
    NEUTRAL: '#6b7280',   // Gray
  },
  ZONES: {
    OFFENSIVE: 'rgba(239, 68, 68, 0.3)',   // Red tint
    NEUTRAL: 'rgba(107, 114, 128, 0.1)',   // Gray tint
    DEFENSIVE: 'rgba(59, 130, 246, 0.3)',  // Blue tint
  },
  ICE: '#f0f8ff',         // Light blue
  LINES: {
    RED: '#c8102e',
    BLUE: '#0038a8',
    BLACK: '#000000',
  },
} as const;

// League Averages (fallback values - should be dynamically fetched)
export const LEAGUE_AVERAGES = {
  SHOOTING_PCT: 10.5,
  SAVE_PCT: 90.5,
  GOALS_PER_GAME: 3.0,
  SHOTS_PER_GAME: 31,
  XG_PER_SHOT: 0.08,
  CORSI_FOR_PCT: 50,
  FENWICK_FOR_PCT: 50,
  PDO: 100,
  POWER_PLAY_PCT: 20,
  PENALTY_KILL_PCT: 80,
  HIGH_DANGER_SHOT_PCT: 18,
  SHOT_ATTEMPTS_PER_SHOT: 1.8,
} as const;

// Convenience aliases for common imports
export const RINK_DIMENSIONS = {
  X_MIN: COORDINATES.MIN_X,
  X_MAX: COORDINATES.MAX_X,
  Y_MIN: COORDINATES.MIN_Y,
  Y_MAX: COORDINATES.MAX_Y,
} as const;

export const ZONE_COLORS = {
  HIGH_DANGER: '#ef4444',
  MEDIUM_DANGER: '#f59e0b',
  LOW_DANGER: '#3b82f6',
} as const;

// Helper functions
export function getZoneFromX(x: number): 'defensive' | 'neutral' | 'offensive' {
  if (x < ZONES.DEFENSIVE.MAX_X) return 'defensive';
  if (x > ZONES.OFFENSIVE.MIN_X) return 'offensive';
  return 'neutral';
}

export function isInSlot(x: number, y: number): boolean {
  const normalizedX = (x + 100) / 2; // Convert -100..100 to 0..100
  return normalizedX >= SLOT.MIN_X && normalizedX <= SLOT.MAX_X &&
         y >= SLOT.MIN_Y && y <= SLOT.MAX_Y;
}

export function getDistanceFromGoal(x: number, y: number, isHomeTeamAttacking: boolean): number {
  const goalX = isHomeTeamAttacking ? GOALS.AWAY.X : GOALS.HOME.X;
  const goalY = 0;
  return Math.sqrt(Math.pow(x - goalX, 2) + Math.pow(y - goalY, 2));
}

export function getAngleFromGoal(x: number, y: number, isHomeTeamAttacking: boolean): number {
  const goalX = isHomeTeamAttacking ? GOALS.AWAY.X : GOALS.HOME.X;
  const distanceX = Math.abs(goalX - x);
  const distanceY = Math.abs(y);
  return Math.atan2(distanceY, distanceX) * (180 / Math.PI);
}

export function normalizeCoordinates(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - COORDINATES.MIN_X) / (COORDINATES.MAX_X - COORDINATES.MIN_X) * 100,
    y: (y - COORDINATES.MIN_Y) / (COORDINATES.MAX_Y - COORDINATES.MIN_Y) * 100,
  };
}

export function getDangerLevel(xg: number): 'low' | 'medium' | 'high' {
  if (xg >= XG_THRESHOLDS.HIGH_DANGER) return 'high';
  if (xg >= XG_THRESHOLDS.MEDIUM_DANGER) return 'medium';
  return 'low';
}
