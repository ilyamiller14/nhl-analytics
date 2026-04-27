/**
 * GoalieSpatialPanel — Save Map vs Expected, sibling to
 * SpatialSignaturePanel. Same 20×8 grid + Gaussian KDE renderer, but
 * the data is shots FACED by the goalie and the per-cell metric is
 * GSAx-per-cell rather than xG-share-deviation.
 *
 * Per-cell metric: (xG_in_cell − goals_in_cell) — i.e. expected goals
 * minus actual goals scored in that cell. Positive = goalie stopped
 * more than expected (green); negative = leaking (red). The xG model
 * already encodes the league expectation for each shot's location/
 * type/strength/situation, so the diff vs xG is itself the "vs league"
 * comparison — no separate goalie-baseline endpoint required.
 *
 * Caption: "Save map vs expected · {N} shots".
 */

import { useMemo } from 'react';

interface GoalieFacedShot {
  x: number;
  y: number;
  result: 'goal' | 'shot' | 'miss' | 'block';
  xGoal?: number;
}

interface GoalieSpatialPanelProps {
  /** Shots this goalie faced this season (from useGoalieShotsAgainst). */
  shots: GoalieFacedShot[];
  width?: number;
  height?: number;
  /** σ in cell units. ~1.4 ≈ HockeyViz-feel KDE. */
  smoothSigma?: number;
}

const GRID_W = 20;
const GRID_H = 8;
const HALF_RINK_X_MAX = 100;
const HALF_RINK_Y_MIN = -42.5;
const HALF_RINK_Y_MAX = 42.5;

export default function GoalieSpatialPanel({
  shots,
  width = 380,
  height = 220,
  smoothSigma = 1.4,
}: GoalieSpatialPanelProps) {
  // Aggregate the goalie's faced-shot xG and goal mass per cell.
  // Same half-rink mirroring as SpatialSignaturePanel — reflect every
  // shot to the +X side and flip Y when X<0 so the "shooter approaches
  // the net we're defending" perspective is consistent regardless of
  // which end the goalie was actually on.
  //
  // Filter out blocked shots — they never reached the goalie and
  // therefore can't be saved or scored on. xG models include block
  // events as "attempted shots" for some workflows but for the goalie
  // save map a blocked shot at the point isn't a save opportunity.
  const { xgGrid, goalGrid, totalShots } = useMemo(() => {
    const cellW = HALF_RINK_X_MAX / GRID_W;
    const cellH = (HALF_RINK_Y_MAX - HALF_RINK_Y_MIN) / GRID_H;
    const xg = new Float64Array(GRID_W * GRID_H);
    const goal = new Float64Array(GRID_W * GRID_H);
    let n = 0;
    for (const s of shots) {
      if (s.x === undefined || s.y === undefined) continue;
      // Skip blocked shots — see comment above.
      if (s.result === 'block') continue;
      const normX = Math.abs(s.x);
      const normY = s.x < 0 ? -s.y : s.y;
      const gx = Math.min(GRID_W - 1, Math.max(0, Math.floor(normX / cellW)));
      const gy = Math.min(GRID_H - 1, Math.max(0, Math.floor((normY - HALF_RINK_Y_MIN) / cellH)));
      xg[gx * GRID_H + gy] += s.xGoal ?? 0;
      if (s.result === 'goal') goal[gx * GRID_H + gy] += 1;
      n++;
    }
    return { xgGrid: xg, goalGrid: goal, totalShots: n };
  }, [shots]);

  // Per-cell GSAx = xG_cell − goals_cell. Positive = stopped more than
  // expected (goalie value); negative = leaking. Then smooth with KDE
  // so low-sample cells inherit some signal from neighbors instead of
  // looking like scatter noise.
  const { gsaxGrid, coverageGrid } = useMemo(() => {
    const N = GRID_W * GRID_H;
    const gsax = new Float64Array(N);
    const cov = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      gsax[i] = xgGrid[i] - goalGrid[i];
      // Coverage = total xG mass in the cell (regardless of outcome).
      // High xG cells get more opacity so cold zones don't visually
      // dominate just because their tiny GSAx is "extreme" relative to
      // their negligible sample.
      cov[i] = xgGrid[i];
    }
    const smGsax = smoothSigma > 0 ? separableGaussian(gsax, GRID_W, GRID_H, smoothSigma) : gsax;
    const smCov = smoothSigma > 0 ? separableGaussian(cov, GRID_W, GRID_H, smoothSigma) : cov;
    return { gsaxGrid: smGsax, coverageGrid: smCov };
  }, [xgGrid, goalGrid, smoothSigma]);

  const { gsaxMax, covMax } = useMemo(() => {
    let m = 0;
    for (let i = 0; i < gsaxGrid.length; i++) {
      const a = Math.abs(gsaxGrid[i]);
      if (a > m) m = a;
    }
    let cm = 0;
    for (let i = 0; i < coverageGrid.length; i++) {
      if (coverageGrid[i] > cm) cm = coverageGrid[i];
    }
    return { gsaxMax: m > 0 ? m : 1, covMax: cm > 0 ? cm : 1 };
  }, [gsaxGrid, coverageGrid]);

  if (totalShots === 0) {
    // Empty state — keeps the share card chrome consistent so the slot
    // doesn't collapse and reflow the whole bottom row.
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ background: '#0f1218', borderRadius: 8 }}
        role="img"
        aria-label="Save map vs expected — no shot data available"
      >
        <text x={width / 2} y={height / 2}
          textAnchor="middle" dominantBaseline="middle"
          fill="rgba(255,255,255,0.55)" fontSize={12}
          fontFamily="-apple-system, system-ui, sans-serif">
          Loading shots faced…
        </text>
      </svg>
    );
  }

  const cellPxW = width / GRID_W;
  const cellPxH = height / GRID_H;

  const cellRects: { x: number; y: number; fill: string; opacity: number }[] = [];
  for (let gx = 0; gx < GRID_W; gx++) {
    for (let gy = 0; gy < GRID_H; gy++) {
      const idx = gx * GRID_H + gy;
      const gsax = gsaxGrid[idx];
      const cov = coverageGrid[idx];
      // Skip cells with negligible xG mass — cleaner than rendering a
      // grey square at parity-with-zero-data. Threshold tuned to match
      // SpatialSignaturePanel.
      if (cov < 0.0008 * covMax + 0.0001) continue;
      // Color sign: positive GSAx (xG > goals) = goalie stopped more
      // than expected = GREEN. Negative GSAx (goals > xG) = goalie
      // leaked = RED. NB: this is OPPOSITE to the skater panel's
      // convention where red = "above-league shot generation" because
      // the SUBJECT here is the defender, not the attacker. The
      // caption explicitly states "green = stopping more than
      // expected" so a reader can't get this wrong.
      const t = Math.max(-1, Math.min(1, gsax / gsaxMax));
      const fill = goalieDivergingColor(t);
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
      aria-label="Save map vs expected"
    >
      {/* Rink markings — same overlay as SpatialSignaturePanel so the
          two panels read as a coherent set in side-by-side share-card
          previews comparing skater vs goalie cards. */}
      {(() => {
        const xPx = (nhlX: number) => (nhlX / 100) * width;
        const yPx = (nhlY: number) => ((42.5 - nhlY) / 85) * height;
        const ftX = width / 100;
        const ftY = height / 85;
        const FAINT = 'rgba(255,255,255,0.20)';
        const RED = 'rgba(255,90,90,0.55)';
        const BLUE = 'rgba(120,170,255,0.55)';
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
            <rect x={0.5} y={0.5} width={width - 1} height={height - 1}
                  fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} rx={6} />
            <line x1={xPx(25)} y1={0} x2={xPx(25)} y2={height}
                  stroke={BLUE} strokeWidth={1.5} />
            <line x1={xPx(89)} y1={0} x2={xPx(89)} y2={height}
                  stroke={RED} strokeWidth={1.3} />
            <line x1={0} y1={0} x2={0} y2={height} stroke={FAINT} strokeWidth={1} />
            {circle15(69, 22)}
            {circle15(69, -22)}
            {dot(69, 22)}
            {dot(69, -22)}
            <path
              d={`M ${xPx(89)} ${yPx(6)} A ${6 * ftX} ${6 * ftY} 0 0 0 ${xPx(89)} ${yPx(-6)}`}
              fill="none" stroke={FAINT} strokeWidth={1}
            />
          </g>
        );
      })()}
      {/* Heat cells over the rink */}
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
      {/* Caption — explicit so a screenshotted card carries its own
          legend. The "green = stopping more than expected, red =
          leaking" framing is critical because the color convention is
          INVERTED from the skater panel (where red = above-league shot
          generation). */}
      <text x={8} y={height - 8} fill="rgba(255,255,255,0.65)" fontSize={10}
            fontFamily="-apple-system, system-ui, sans-serif">
        {`Save map vs expected · green = above xG · ${totalShots} shots`}
      </text>
    </svg>
  );
}

// Goalie diverging palette: t ∈ [-1, 1].
//   t = -1 → goalie leaked the most → red
//   t =  0 → goalie matched expectation → light grey
//   t = +1 → goalie stopped the most → green
// Inverted relative to SpatialSignaturePanel (which uses red for
// "above-league xG generation" — the attacker's perspective).
function goalieDivergingColor(t: number): string {
  if (t >= 0) {
    // White → green
    const r = Math.round(255 - 200 * t);
    const g = 255;
    const b = Math.round(255 - 180 * t);
    return `rgb(${Math.max(0, r)},${g},${Math.max(0, b)})`;
  }
  // White → red
  const r = 255;
  const g = Math.round(255 + 200 * t);
  const b = Math.round(255 + 200 * t);
  return `rgb(${r},${Math.max(0, g)},${Math.max(0, b)})`;
}

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
