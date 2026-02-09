/**
 * Time Utilities
 *
 * Shared time parsing and conversion functions for hockey analytics.
 */

/**
 * Parse a time string in MM:SS format to total seconds.
 *
 * @param timeStr - Time string in "MM:SS" format
 * @returns Total seconds (e.g., "5:30" → 330)
 *
 * @example
 * parseTimeToSeconds("12:30") // 750
 * parseTimeToSeconds("0:45")  // 45
 * parseTimeToSeconds("")      // 0
 */
export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const minutes = parseInt(parts[0] || '0', 10);
  const seconds = parseInt(parts[1] || '0', 10);
  return minutes * 60 + seconds;
}

/**
 * Convert total seconds to MM:SS format string.
 *
 * @param totalSeconds - Total seconds
 * @returns Time string in "MM:SS" format
 *
 * @example
 * secondsToTimeString(750) // "12:30"
 * secondsToTimeString(45)  // "0:45"
 */
export function secondsToTimeString(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Calculate the duration between two time strings.
 *
 * @param startTime - Start time in "MM:SS" format
 * @param endTime - End time in "MM:SS" format
 * @returns Duration in seconds
 */
export function calculateDuration(startTime: string, endTime: string): number {
  return Math.abs(parseTimeToSeconds(endTime) - parseTimeToSeconds(startTime));
}
