// Utility functions for formatting numbers, percentages, and other data

/**
 * Format a number with specified decimal places
 */
export function formatNumber(value: number | undefined, decimals: number = 0): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }
  return value.toFixed(decimals);
}

/**
 * Format a percentage value
 */
export function formatPercentage(value: number | undefined, decimals: number = 1): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format time on ice from seconds to MM:SS format
 */
export function formatTOI(seconds: number | undefined): string {
  if (!seconds || isNaN(seconds)) {
    return '-';
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format TOI string (already in MM:SS format) to display format
 */
export function formatTOIString(toi: string | undefined): string {
  if (!toi) {
    return '-';
  }
  return toi;
}

/**
 * Convert TOI string (MM:SS) to seconds
 */
export function toiToSeconds(toi: string): number {
  if (!toi || toi === '-') {
    return 0;
  }

  const parts = toi.split(':');
  if (parts.length !== 2) {
    return 0;
  }

  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);

  if (isNaN(minutes) || isNaN(seconds)) {
    return 0;
  }

  return minutes * 60 + seconds;
}

/**
 * Format height from inches to feet and inches
 */
export function formatHeight(inches: number | undefined): string {
  if (!inches || isNaN(inches)) {
    return '-';
  }

  const feet = Math.floor(inches / 12);
  const remainingInches = inches % 12;

  return `${feet}'${remainingInches}"`;
}

/**
 * Format weight in pounds
 */
export function formatWeight(pounds: number | undefined): string {
  if (!pounds || isNaN(pounds)) {
    return '-';
  }

  return `${pounds} lbs`;
}

/**
 * Format date to readable format
 */
export function formatDate(dateString: string | undefined): string {
  if (!dateString) {
    return '-';
  }

  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Calculate age from birth date
 */
export function calculateAge(birthDate: string | undefined): number | null {
  if (!birthDate) {
    return null;
  }

  try {
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    return age;
  } catch {
    return null;
  }
}

/**
 * Format season ID to readable format (e.g., 20242025 -> "2024-25")
 */
export function formatSeasonId(seasonId: number | string): string {
  const seasonStr = seasonId.toString();

  if (seasonStr.length !== 8) {
    return seasonStr;
  }

  const startYear = seasonStr.substring(0, 4);
  const endYear = seasonStr.substring(6, 8);

  return `${startYear}-${endYear}`;
}

/**
 * Format large numbers with commas
 */
export function formatWithCommas(value: number | undefined): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }

  return value.toLocaleString('en-US');
}

/**
 * Format plus/minus stat with + sign for positive values
 */
export function formatPlusMinus(value: number | undefined): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }

  if (value > 0) {
    return `+${value}`;
  }

  return value.toString();
}

/**
 * Format save percentage for goalies
 * NHL API may return savePctg as a decimal (e.g., 0.915) or as a value >= 1 (e.g., 91.5)
 * Displays as ".915" format (standard goalie SV% display)
 */
export function formatSavePct(value: number | null | undefined): string {
  if (value == null || isNaN(value)) {
    return '-';
  }

  // If value >= 1, it's already in percentage form (e.g., 91.5) — convert to decimal
  const decimal = value >= 1 ? value / 100 : value;
  return decimal.toFixed(3);
}

/**
 * Format shooting percentage
 * NHL API returns shootingPctg as a decimal (e.g., 0.0945 for 9.45%)
 */
export function formatShootingPct(value: number | undefined): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '-';
  }

  // NHL API returns as decimal (0.0945), convert to percentage display
  // If value is already >= 1, it's already a percentage
  const pct = value >= 1 ? value : value * 100;
  return `${pct.toFixed(1)}%`;
}

/**
 * Abbreviate position codes to full names
 */
export function formatPosition(positionCode: string): string {
  const positions: { [key: string]: string } = {
    C: 'Center',
    L: 'Left Wing',
    R: 'Right Wing',
    D: 'Defense',
    G: 'Goalie',
    LW: 'Left Wing',
    RW: 'Right Wing',
  };

  return positions[positionCode] || positionCode;
}

/**
 * Get position abbreviation color class
 */
export function getPositionColor(positionCode: string): string {
  if (positionCode === 'C') return 'center';
  if (positionCode === 'L' || positionCode === 'LW' || positionCode === 'R' || positionCode === 'RW')
    return 'wing';
  if (positionCode === 'D') return 'defense';
  if (positionCode === 'G') return 'goalie';
  return 'default';
}
