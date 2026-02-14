/**
 * Season utility functions
 * Dynamically determines the current NHL season based on date
 */

/**
 * Get the current NHL season string (e.g., "20252026")
 * NHL season starts in October, so Aug+ is considered the new season
 */
export function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  // NHL season starts in October (month 9), preseason in September
  // Use August (month 7) as cutoff for new season
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}

/**
 * Get the current season as a number (e.g., 20252026)
 */
export function getCurrentSeasonId(): number {
  return parseInt(getCurrentSeason(), 10);
}

/**
 * Format a season string for display (e.g., "20252026" -> "2025-26")
 */
export function formatSeasonString(season: string): string {
  const startYear = season.slice(0, 4);
  const endYear = season.slice(6, 8) || season.slice(4, 6);
  return `${startYear}-${endYear}`;
}
