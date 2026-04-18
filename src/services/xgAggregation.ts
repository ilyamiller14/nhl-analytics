/**
 * Grids shots into offensive-zone cells and aggregates expected vs actual
 * goals. Used by the xG Residual Heatmap — the core differentiating viz
 * showing where a player or team out-performs (or under-performs) the
 * empirical model.
 */

import { normalizeToOffensiveZone } from '../components/charts/NHLRink';

export interface ShotForGrid {
  x: number;
  y: number;
  result: 'goal' | 'shot' | 'miss' | 'block';
  xGoal: number;
}

export interface GridCell {
  col: number;
  row: number;
  ozX: number;   // offensive-zone NHL coords (center of cell)
  ozY: number;
  shots: number;
  goals: number;
  xG: number;
  residual: number; // goals - xG
}

export interface GridConfig {
  // Offensive-zone-only: NHL X ∈ [0, 100], Y ∈ [-42.5, 42.5].
  xCells: number;
  yCells: number;
  minShots: number; // cells with fewer shots are hidden (low signal)
}

// Team-scale defaults: 5×4 coarse grid, min 15 shots per cell. A single
// cell at (distance 15 ft, central) will cover ~20ft × ~21ft — wide
// enough that 15 shots is a stable sample, specific enough to locate
// strengths and weaknesses. Player-scale use is discouraged; a forward
// with 150 season shots leaves most cells empty.
export const DEFAULT_GRID: GridConfig = { xCells: 5, yCells: 4, minShots: 15 };

const OZ_X_MIN = 0;
const OZ_X_MAX = 100;
const Y_MIN = -42.5;
const Y_MAX = 42.5;

export function gridShots(shots: ShotForGrid[], cfg: GridConfig = DEFAULT_GRID): GridCell[] {
  const cells: Map<string, GridCell> = new Map();
  const xStep = (OZ_X_MAX - OZ_X_MIN) / cfg.xCells;
  const yStep = (Y_MAX - Y_MIN) / cfg.yCells;

  for (const s of shots) {
    if (s.result === 'block') continue; // xG is trained on Fenwick only.
    // Mirror all shots into the offensive zone (positive X).
    const oz = normalizeToOffensiveZone(s.x, s.y);
    if (oz.x < OZ_X_MIN || oz.x > OZ_X_MAX) continue;
    if (oz.y < Y_MIN || oz.y > Y_MAX) continue;

    const col = Math.min(cfg.xCells - 1, Math.floor((oz.x - OZ_X_MIN) / xStep));
    const row = Math.min(cfg.yCells - 1, Math.floor((oz.y - Y_MIN) / yStep));
    const key = `${col}|${row}`;

    let cell = cells.get(key);
    if (!cell) {
      cell = {
        col,
        row,
        ozX: OZ_X_MIN + (col + 0.5) * xStep,
        ozY: Y_MIN + (row + 0.5) * yStep,
        shots: 0,
        goals: 0,
        xG: 0,
        residual: 0,
      };
      cells.set(key, cell);
    }
    cell.shots += 1;
    if (s.result === 'goal') cell.goals += 1;
    cell.xG += s.xGoal;
  }

  for (const cell of cells.values()) {
    cell.residual = cell.goals - cell.xG;
  }

  return Array.from(cells.values()).filter(c => c.shots >= cfg.minShots);
}

export interface AggregateTotals {
  attempts: number;      // all shot attempts (Corsi — goal + sog + miss + block)
  unblocked: number;     // Fenwick (goal + sog + miss) — xG denominator
  sog: number;           // shots on goal (goal + sog)
  goals: number;
  xG: number;            // summed over unblocked shots only
  residual: number;      // goals − xG (Fenwick-aligned)
  shootingPct: number;   // goals / SOG (standard NHL definition)
  xGPerFenwick: number;  // xG / unblocked (0-1 probability per attempt that reached/missed net)
}

// xG is only meaningful on shots that reached the net or missed it — the
// lookup was trained on Fenwick. Blocked shots are excluded from xG sums
// AND the residual, so GAX tracks the right denominator. All counts are
// still exposed in case a viewer wants Corsi context.
export function aggregateTotals(shots: ShotForGrid[]): AggregateTotals {
  let attempts = 0, unblocked = 0, sog = 0, goals = 0, xG = 0;
  for (const s of shots) {
    attempts += 1;
    if (s.result === 'block') continue; // Corsi-only — skip xG / SOG
    unblocked += 1;
    xG += s.xGoal;
    if (s.result === 'goal') {
      sog += 1;
      goals += 1;
    } else if (s.result === 'shot') {
      sog += 1;
    }
  }
  return {
    attempts,
    unblocked,
    sog,
    goals,
    xG,
    residual: goals - xG,
    shootingPct: sog > 0 ? (goals / sog) * 100 : 0,
    xGPerFenwick: unblocked > 0 ? xG / unblocked : 0,
  };
}
