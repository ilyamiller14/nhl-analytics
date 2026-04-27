/**
 * SpatialSignaturePanel — HockeyViz-style ISOLATED IMPACT heat map for
 * the shareable PlayerAnalyticsCard. Renders the player's xG-mass-per-
 * cell concentration MINUS the league baseline concentration at the
 * same cell — answers "where does this player generate danger
 * differently than a typical NHL skater?"
 *
 * Pipeline:
 *  1. Per-cell player xG mass (xG-weighted, Phase 2.5/A).
 *  2. Convert to fraction of player's total xG (player_frac per cell).
 *  3. Subtract league_frac per cell (from /cached/league-xg-grid, baked
 *     daily by the worker — see workers/src/index.ts buildLeagueXgGrid).
 *  4. Apply 2D Gaussian smoother (Phase 2.5/B) for KDE-style contours.
 *  5. Diverging palette: red = above-league concentration at this
 *     cell, blue = below-league. White at parity. Color is
 *     league-relative; opacity is keyed off |deviation| so cells where
 *     the player matches league fade out of the visual.
 *
 * Falls back to "raw mass relative to player's own median" when the
 * league grid hasn't loaded — the panel still renders, just without
 * the cross-player comparison.
 *
 * Why a fresh component vs reusing AttackDNAv2:
 *  - Share card needs a STATIC, fixed-aspect SVG for `html-to-image`.
 *  - The card only has the simplified `{x, y, result, xGoal}` shape.
 *  - Self-contained so the export pipeline doesn't depend on the
 *    broader Attack DNA service (passes, edge fetches, etc).
 */

import { useEffect, useMemo, useState } from 'react';
import { API_CONFIG } from '../../config/api';

interface ShareShot {
  x: number;
  y: number;
  result: 'goal' | 'shot' | 'miss' | 'block';
  xGoal?: number;
}

interface SpatialSignaturePanelProps {
  shots: ShareShot[];
  width?: number;
  height?: number;
  /** σ in cell units. 0 disables. ~1.2 ≈ HockeyViz-feel KDE. */
  smoothSigma?: number;
}

const GRID_W = 20;
const GRID_H = 8;

// Module-level cache for the league grid. Fetched once per page load.
// Shape matches workers/src/index.ts LeagueXgGridArtifact.
interface LeagueXgGridArtifact {
  schemaVersion: number;
  season: string;
  gamesAnalyzed: number;
  totalShots: number;
  totalXg: number;
  baselineXgPerShot: number;
  gridWidth: number;
  gridHeight: number;
  xgGrid: number[];   // row-major gx*H + gy
  shotGrid: number[];
}
let leagueGridCache: LeagueXgGridArtifact | null = null;
let leagueGridFetchPromise: Promise<LeagueXgGridArtifact | null> | null = null;
async function loadLeagueGrid(): Promise<LeagueXgGridArtifact | null> {
  if (leagueGridCache) return leagueGridCache;
  if (leagueGridFetchPromise) return leagueGridFetchPromise;
  leagueGridFetchPromise = (async () => {
    try {
      const base = (API_CONFIG.NHL_WEB || '').replace(/\/web$/, '');
      // Worker endpoint hits the proxied origin.
      const url = `${base}/cached/league-xg-grid`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as LeagueXgGridArtifact;
      if (!data || !Array.isArray(data.xgGrid) || data.xgGrid.length !== GRID_W * GRID_H) {
        return null;
      }
      leagueGridCache = data;
      return data;
    } catch {
      return null;
    }
  })();
  return leagueGridFetchPromise;
}
// Half-rink offensive zone (the goal is at x ≈ 89 on the +X side).
// We mirror everything to the +X side so the panel always shows
// "shots toward the net we're attacking."
const HALF_RINK_X_MAX = 100;
const HALF_RINK_Y_MIN = -42.5;
const HALF_RINK_Y_MAX = 42.5;

export default function SpatialSignaturePanel({
  shots,
  width = 380,
  height = 220,
  smoothSigma = 1.2,
}: SpatialSignaturePanelProps) {
  // League grid is async — the panel renders fall-back ("vs own median")
  // while waiting and re-renders to "vs league" once loaded.
  const [leagueGrid, setLeagueGrid] = useState<LeagueXgGridArtifact | null>(leagueGridCache);
  useEffect(() => {
    if (leagueGridCache) return;
    let alive = true;
    loadLeagueGrid().then((g) => { if (alive && g) setLeagueGrid(g); });
    return () => { alive = false; };
  }, []);

  // Aggregate the player's xG mass per cell over the offensive half-rink.
  // Half-rink mirroring matches computeShotDensityMap and the worker's
  // buildLeagueXgGrid: mirror X to positive, flip Y when X<0 so the
  // player's strong side maps to the same screen side regardless of
  // attacking direction.
  const playerGrid = useMemo(() => {
    const cellW = HALF_RINK_X_MAX / GRID_W;
    const cellH = (HALF_RINK_Y_MAX - HALF_RINK_Y_MIN) / GRID_H;
    const raw = new Float64Array(GRID_W * GRID_H);
    for (const s of shots) {
      if (s.x === undefined || s.y === undefined) continue;
      const normX = Math.abs(s.x);
      const normY = s.x < 0 ? -s.y : s.y;
      const gx = Math.min(GRID_W - 1, Math.max(0, Math.floor(normX / cellW)));
      const gy = Math.min(GRID_H - 1, Math.max(0, Math.floor((normY - HALF_RINK_Y_MIN) / cellH)));
      raw[gx * GRID_H + gy] += s.xGoal ?? 0;
    }
    return raw;
  }, [shots]);

  // We render TWO fields:
  //   • dev[]      — per-cell deviation (player_frac − league_frac).
  //                  Drives COLOR (red=above-league, blue=below-league).
  //   • coverage[] — per-cell max(playerFrac, leagueFrac).
  //                  Drives OPACITY so cells with real activity (by
  //                  player OR league) render even at parity. Without
  //                  this, defensemen's point-shot zone reads as "no
  //                  data" because they match the league rate there.
  // Falls back to "vs even-distribution" when the league grid hasn't
  // loaded — keeps the panel useful while async fetch is in flight.
  const { devGrid, coverageGrid, mode } = useMemo(() => {
    let playerTotal = 0;
    for (let i = 0; i < playerGrid.length; i++) playerTotal += playerGrid[i];
    const N = GRID_W * GRID_H;
    if (playerTotal <= 0) return {
      devGrid: new Float64Array(N), coverageGrid: new Float64Array(N), mode: 'vs-self' as const,
    };

    if (leagueGrid && leagueGrid.xgGrid.length === N) {
      let leagueTotal = 0;
      for (let i = 0; i < leagueGrid.xgGrid.length; i++) leagueTotal += leagueGrid.xgGrid[i];
      if (leagueTotal > 0) {
        const dev = new Float64Array(N);
        const cov = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          const pf = playerGrid[i] / playerTotal;
          const lf = leagueGrid.xgGrid[i] / leagueTotal;
          dev[i] = pf - lf;
          cov[i] = Math.max(pf, lf);
        }
        const smoothedDev = smoothSigma > 0 ? separableGaussian(dev, GRID_W, GRID_H, smoothSigma) : dev;
        const smoothedCov = smoothSigma > 0 ? separableGaussian(cov, GRID_W, GRID_H, smoothSigma) : cov;
        return { devGrid: smoothedDev, coverageGrid: smoothedCov, mode: 'vs-league' as const };
      }
    }
    const meanFrac = 1 / N;
    const dev = new Float64Array(N);
    const cov = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const pf = playerGrid[i] / playerTotal;
      dev[i] = pf - meanFrac;
      cov[i] = pf;
    }
    const smoothedDev = smoothSigma > 0 ? separableGaussian(dev, GRID_W, GRID_H, smoothSigma) : dev;
    const smoothedCov = smoothSigma > 0 ? separableGaussian(cov, GRID_W, GRID_H, smoothSigma) : cov;
    return { devGrid: smoothedDev, coverageGrid: smoothedCov, mode: 'vs-self' as const };
  }, [playerGrid, leagueGrid, smoothSigma]);

  // Symmetric color scale around 0 deviation. The cap is the absolute
  // max deviation; coverage uses its own max.
  const { devMax, covMax } = useMemo(() => {
    let dm = 0;
    for (let i = 0; i < devGrid.length; i++) {
      const a = Math.abs(devGrid[i]);
      if (a > dm) dm = a;
    }
    let cm = 0;
    for (let i = 0; i < coverageGrid.length; i++) {
      if (coverageGrid[i] > cm) cm = coverageGrid[i];
    }
    return { devMax: dm > 0 ? dm : 1, covMax: cm > 0 ? cm : 1 };
  }, [devGrid, coverageGrid]);

  // SVG layout: render the rink outline with the offensive net at the
  // right edge, then overlay the cells.
  const cellPxW = width / GRID_W;
  const cellPxH = height / GRID_H;

  const cellRects: { x: number; y: number; fill: string; opacity: number }[] = [];
  for (let gx = 0; gx < GRID_W; gx++) {
    for (let gy = 0; gy < GRID_H; gy++) {
      const idx = gx * GRID_H + gy;
      const dev = devGrid[idx];
      const cov = coverageGrid[idx];
      // Skip cells where neither the player nor league has activity.
      if (cov < 0.0008) continue;          // ~0.08% of total xG = essentially empty
      // Color is keyed off the deviation; opacity is keyed off the
      // coverage (max activity by either side). Together this gives:
      //   parity in a high-traffic zone → light grey, visible
      //   above-league in high-traffic zone → bright red
      //   below-league in low-traffic zone → faint blue
      const t = Math.max(-1, Math.min(1, dev / devMax));
      const fill = divergingColor(t);
      // Coverage opacity baseline 0.20 so even faint cells render; cap
      // at 0.95 so the rink outline / faceoff dots remain visible
      // through the heat field.
      const cRatio = Math.min(1, cov / covMax);
      const opacity = Math.min(0.95, 0.20 + cRatio * 0.75);
      const px = gx * cellPxW;
      const py = (GRID_H - 1 - gy) * cellPxH;
      cellRects.push({ x: px, y: py, fill, opacity });
    }
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ background: '#0f1218', borderRadius: 8 }}
      role="img"
      aria-label="xG-weighted shot signature"
    >
      {/* Rink markings — drawn UNDER the heat cells so the heat reads
          first, but the points/circles remain visible through the
          cell opacity (max 0.95). Coordinate convention:
            x maps NHL X = 0..100 → 0..width (mirrored to offensive half)
            y maps NHL Y = +42.5 (top of panel) .. −42.5 (bottom)
          So Y=+22 is at the TOP faceoff dot, Y=−22 is at the BOTTOM. */}
      {(() => {
        const xPx = (nhlX: number) => (nhlX / 100) * width;
        // Y growns downward in SVG; +Y NHL → top of panel (y=0 in SVG).
        const yPx = (nhlY: number) => ((42.5 - nhlY) / 85) * height;
        // 1 NHL ft horizontally / vertically in pixels
        const ftX = width / 100;
        const ftY = height / 85;
        const FAINT = 'rgba(255,255,255,0.20)';
        const RED   = 'rgba(255,90,90,0.55)';
        const BLUE  = 'rgba(120,170,255,0.55)';
        // Faceoff dots: NHL offensive-zone faceoff dots are at X=69, Y=±22.
        // Faceoff circles are 15 ft radius (so ~15*ftX wide). They render
        // as ellipses because ftX ≠ ftY when the panel aspect isn't 100:85.
        const dot = (nhlX: number, nhlY: number, fill = RED) => (
          <circle cx={xPx(nhlX)} cy={yPx(nhlY)} r={2.5} fill={fill} />
        );
        const circle15 = (nhlX: number, nhlY: number) => (
          <ellipse
            cx={xPx(nhlX)} cy={yPx(nhlY)}
            rx={15 * ftX} ry={15 * ftY}
            fill="none" stroke={RED} strokeWidth={1.1}
          />
        );
        return (
          <g>
            {/* Half-rink outer boundary */}
            <rect x={0.5} y={0.5} width={width - 1} height={height - 1}
                  fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} rx={6} />
            {/* Blue line at NHL X=25 (offensive blue line on the +X side) */}
            <line x1={xPx(25)} y1={0} x2={xPx(25)} y2={height}
                  stroke={BLUE} strokeWidth={1.5} />
            {/* Goal line at NHL X=89 */}
            <line x1={xPx(89)} y1={0} x2={xPx(89)} y2={height}
                  stroke={RED} strokeWidth={1.3} />
            {/* Center-of-rink line (own-goal side) at NHL X=0 — left
                edge of this projection, drawn faintly for context. */}
            <line x1={0} y1={0} x2={0} y2={height} stroke={FAINT} strokeWidth={1} />
            {/* Offensive zone faceoff circles + dots (X=69, Y=±22) */}
            {circle15(69, 22)}
            {circle15(69, -22)}
            {dot(69, 22)}
            {dot(69, -22)}
            {/* Defensive "points" — typical D position just inside the
                blue line. Hockey strategy term, not a precise NHL spec.
                A small × marker with a tiny "P" label so a fan reading
                the card can identify "this is where defensemen shoot
                from." Placed at X=30, Y=±20. */}
            {[20, -20].map((py, i) => (
              <g key={`pt-${i}`} opacity={0.9}>
                <line x1={xPx(30) - 4} y1={yPx(py) - 4} x2={xPx(30) + 4} y2={yPx(py) + 4}
                      stroke={FAINT} strokeWidth={1.2} />
                <line x1={xPx(30) - 4} y1={yPx(py) + 4} x2={xPx(30) + 4} y2={yPx(py) - 4}
                      stroke={FAINT} strokeWidth={1.2} />
                <text x={xPx(30) + 7} y={yPx(py) + 3} fill="rgba(255,255,255,0.5)"
                      fontSize={9} fontFamily="-apple-system, system-ui, sans-serif">
                  point
                </text>
              </g>
            ))}
            {/* Crease — semicircle on the attacking side of the net.
                NHL crease is 6ft radius centered at (X=89, Y=0). We
                draw an arc that opens away from the net (toward the
                shooter perspective). */}
            <path
              d={`M ${xPx(89)} ${yPx(6)} A ${6 * ftX} ${6 * ftY} 0 0 0 ${xPx(89)} ${yPx(-6)}`}
              fill="none" stroke={FAINT} strokeWidth={1}
            />
          </g>
        );
      })()}
      {/* Cells — drawn ON TOP of rink markings, but with opacity ≤ 0.95
          so the markings still show through where deviation is high. */}
      {cellRects.map((c, i) => (
        <rect key={i}
              x={c.x} y={c.y}
              width={cellPxW + 0.5} height={cellPxH + 0.5}
              fill={c.fill}
              opacity={c.opacity} />
      ))}
      {/* Net marker — drawn LAST so the post outline is always visible. */}
      <rect
        x={(89 / 100) * width - 4}
        y={height / 2 - 8}
        width={8}
        height={16}
        fill="none"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth={1.2}
      />
      {/* Caption strip — explicit about what the colors mean so a
          screenshotted card carries its own legend. */}
      <text x={8} y={height - 8} fill="rgba(255,255,255,0.65)" fontSize={10}
            fontFamily="-apple-system, system-ui, sans-serif">
        {mode === 'vs-league'
          ? `Isolated impact vs NHL · red = above-league xG concentration · ${shots.length} shots`
          : `xG concentration vs even-distribution baseline · ${shots.length} shots`}
      </text>
    </svg>
  );
}

// Diverging palette: t ∈ [-1, 1]. -1 = cool blue, 0 = white, +1 = warm red.
// Tuned for dark backgrounds — the white midpoint reads as light grey.
function divergingColor(t: number): string {
  if (t >= 0) {
    // White → red
    const r = 255;
    const g = Math.round(255 - 200 * t);
    const b = Math.round(255 - 220 * t);
    return `rgb(${r},${g},${b})`;
  }
  // White → blue
  const r = Math.round(255 + 200 * t); // t<0 → r<255
  const g = Math.round(255 + 110 * t);
  const b = 255;
  return `rgb(${Math.max(0, r)},${Math.max(0, g)},${b})`;
}

// Separable 2D Gaussian smoother. σ in cell units; kernel half-width
// clamped to ⌈3σ⌉. Returns a fresh Float64Array of length W*H.
function separableGaussian(grid: Float64Array, W: number, H: number, sigma: number): Float64Array {
  if (sigma <= 0) return grid;
  const kHalf = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let kSum = 0;
  for (let d = -kHalf; d <= kHalf; d++) {
    const w = Math.exp(-(d * d) / (2 * sigma * sigma));
    kernel.push(w);
    kSum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;
  const idx = (gx: number, gy: number) => gx * H + gy;
  const tmp = new Float64Array(W * H);
  const out = new Float64Array(W * H);
  // Pass 1: along X.
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      let s = 0;
      for (let d = -kHalf; d <= kHalf; d++) {
        const xi = gx + d;
        if (xi < 0 || xi >= W) continue;
        s += grid[idx(xi, gy)] * kernel[d + kHalf];
      }
      tmp[idx(gx, gy)] = s;
    }
  }
  // Pass 2: along Y.
  for (let gx = 0; gx < W; gx++) {
    for (let gy = 0; gy < H; gy++) {
      let s = 0;
      for (let d = -kHalf; d <= kHalf; d++) {
        const yi = gy + d;
        if (yi < 0 || yi >= H) continue;
        s += tmp[idx(gx, yi)] * kernel[d + kHalf];
      }
      out[idx(gx, gy)] = s;
    }
  }
  return out;
}
