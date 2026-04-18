/**
 * Per-archetype efficiency aggregation.
 *
 * Takes a list of AttackSequences and returns each archetype's share of
 * shots plus its conversion (shooting %) and avg xG. Powers the
 * Archetype Efficiency Matrix — a single bubble scatter that reveals
 * which playing styles a team relies on AND whether they actually score.
 */

import type { AttackSequence, PlayArchetype } from '../types/playStyle';

export interface ArchetypeRow {
  archetype: PlayArchetype;
  sequences: number;     // total sequences classified as this archetype
  shots: number;         // sequences that ended in a shot attempt
  goals: number;
  xG: number;
  sharePct: number;      // sequences / total sequences
  shootingPct: number;   // goals / shots (on goal + miss)
  avgXGPerShot: number;
}

export function aggregateArchetypes(sequences: AttackSequence[]): ArchetypeRow[] {
  const byType = new Map<PlayArchetype, ArchetypeRow>();
  for (const s of sequences) {
    let row = byType.get(s.archetype);
    if (!row) {
      row = {
        archetype: s.archetype,
        sequences: 0,
        shots: 0,
        goals: 0,
        xG: 0,
        sharePct: 0,
        shootingPct: 0,
        avgXGPerShot: 0,
      };
      byType.set(s.archetype, row);
    }
    row.sequences += 1;
    if (s.outcome.type === 'shot') {
      row.shots += 1;
      if (s.outcome.shotResult === 'goal') row.goals += 1;
      row.xG += s.outcome.xG ?? 0;
    }
  }

  const total = sequences.length;
  for (const row of byType.values()) {
    row.sharePct = total > 0 ? (row.sequences / total) * 100 : 0;
    row.shootingPct = row.shots > 0 ? (row.goals / row.shots) * 100 : 0;
    row.avgXGPerShot = row.shots > 0 ? row.xG / row.shots : 0;
  }

  return Array.from(byType.values()).sort((a, b) => b.sequences - a.sequences);
}
