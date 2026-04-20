/**
 * Hot/Cold Zone Radial
 *
 * Polar GAX map centered at the opposing net. Angular slices = shot
 * direction relative to the net (0° = straight on, ±90° = sharp left/
 * right). Radial rings = distance from net. Each (slice, ring) cell
 * colored by finishing residual: red = converts above expected from
 * here, blue = below. Cell size encodes shot volume.
 *
 * Shows directional shooting talent in a way a rink-grid cannot —
 * the geometry matches how shots actually unfold (distance + angle
 * from goal, not x/y on a rectangle).
 */

import { useMemo, useState } from 'react';
import './HotColdZoneRadial.css';

interface ShotInput {
  x: number;
  y: number;
  result: 'goal' | 'shot' | 'miss' | 'block';
  xGoal: number;
}

interface Props {
  shots: ShotInput[];
  title?: string;
  size?: number;
  minShotsPerCell?: number;
}

// Angular bins — each slice is a DIRECTIONAL cone from the net
// (−90° = along the goal line left, 0° = straight-on, +90° =
// along the goal line right). The label names describe angle only,
// NOT hockey zones, because a slice extends all the way from the
// goal mouth to the blue line — calling the middle cone "slot"
// (as we used to) is wrong at 55+ ft where the slot doesn't exist.
const ANGLE_BINS = [
  { lo: -90, hi: -60, label: 'L boards' },
  { lo: -60, hi: -35, label: 'wide L' },
  { lo: -35, hi: -12, label: 'mid L' },
  { lo: -12, hi: 12, label: 'center' },
  { lo: 12, hi: 35, label: 'mid R' },
  { lo: 35, hi: 60, label: 'wide R' },
  { lo: 60, hi: 90, label: 'R boards' },
];

// Radial bins: rings by distance from net (ft).
const DIST_BINS = [
  { lo: 0, hi: 12, label: '0-12' },
  { lo: 12, hi: 22, label: '12-22' },
  { lo: 22, hi: 35, label: '22-35' },
  { lo: 35, hi: 55, label: '35-55' },
  { lo: 55, hi: 80, label: '55+' },
];

interface CellData {
  angleIdx: number;
  distIdx: number;
  shots: number;
  goals: number;
  xG: number;
  residual: number;
}

function residualColor(residual: number): string {
  const clamped = Math.max(-3, Math.min(3, residual));
  const t = (clamped + 3) / 6;
  if (t < 0.5) {
    // blue → neutral
    const k = t * 2;
    const r = Math.round(30 + (226 - 30) * k);
    const g = Math.round(58 + (232 - 58) * k);
    const b = Math.round(138 + (240 - 138) * k);
    return `rgb(${r},${g},${b})`;
  }
  // neutral → red
  const k = (t - 0.5) * 2;
  const r = Math.round(226 + (220 - 226) * k);
  const g = Math.round(232 + (38 - 232) * k);
  const b = Math.round(240 + (38 - 240) * k);
  return `rgb(${r},${g},${b})`;
}

export default function HotColdZoneRadial({ shots, title, size = 420, minShotsPerCell = 3 }: Props) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const cells = useMemo<CellData[]>(() => {
    const map = new Map<string, CellData>();
    for (const s of shots) {
      if (s.result === 'block') continue; // Fenwick only.
      const netX = s.x >= 0 ? 89 : -89;
      const dx = s.x - netX;
      const dy = s.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 90) continue;
      // Express the shooter's position in a "looking at the net" frame:
      // localX = distance in front of the goal line (always positive),
      // localY = lateral offset (sign = left/right). The angle between
      // shooter and straight-on is atan2(localY, localX) in degrees.
      const localX = Math.abs(dx);
      const localY = dy;
      const degFromPerp = Math.atan2(localY, localX) * (180 / Math.PI);
      if (degFromPerp < -90 || degFromPerp > 90) continue;

      const angleIdx = ANGLE_BINS.findIndex(b => degFromPerp >= b.lo && degFromPerp < b.hi);
      const distIdx = DIST_BINS.findIndex(b => dist >= b.lo && dist < b.hi);
      if (angleIdx < 0 || distIdx < 0) continue;

      const key = `${angleIdx}|${distIdx}`;
      let cell = map.get(key);
      if (!cell) {
        cell = { angleIdx, distIdx, shots: 0, goals: 0, xG: 0, residual: 0 };
        map.set(key, cell);
      }
      cell.shots += 1;
      if (s.result === 'goal') cell.goals += 1;
      cell.xG += s.xGoal;
    }
    for (const c of map.values()) c.residual = c.goals - c.xG;
    return Array.from(map.values()).filter(c => c.shots >= minShotsPerCell);
  }, [shots, minShotsPerCell]);

  if (cells.length === 0) {
    return (
      <div className="hcr">
        {title && <h3 className="hcr-title">{title}</h3>}
        <div className="hcr-empty">Not enough shots per zone (min {minShotsPerCell} per cell) yet.</div>
      </div>
    );
  }

  // Draw a half-circle (semicircle) centered at bottom middle, pointing up.
  // Net is at the bottom; shooter positions radiate outward and upward.
  // maxR is half the width so the full semicircle (plus outer label ring)
  // fits inside the viewBox; viewBox height is only what the semicircle
  // actually uses so the chart doesn't leave a tall empty band up top.
  const labelPad = 24;
  const cx = size / 2;
  const maxR = size / 2 - labelPad;
  const cy = maxR + labelPad;
  const vbHeight = cy + 28; // room for NET label below the goal line
  const vbWidth = size;
  const innerR = 14; // crease/goal area

  // Map dist bin indices to radii. 5 bins across maxR-innerR.
  const rStep = (maxR - innerR) / DIST_BINS.length;
  const rAt = (idx: number) => innerR + idx * rStep;
  const rMid = (idx: number) => innerR + (idx + 0.5) * rStep;

  const angleToRadian = (deg: number) => (90 - deg) * (Math.PI / 180);
  // deg = 0 (straight on) → 90° on screen (upward). deg = -90 (shooter's left
  // from their POV, which maps to stage-right from the net) → 180° (left).
  // Actually: straight up from net = angle 90° in screen coords. Positive deg → right.

  const arcPath = (aIdx: number, dIdx: number) => {
    const bin = ANGLE_BINS[aIdx];
    const r0 = rAt(dIdx);
    const r1 = rAt(dIdx + 1);
    const a0 = angleToRadian(bin.lo);
    const a1 = angleToRadian(bin.hi);
    const x00 = cx + r0 * Math.cos(a0);
    const y00 = cy - r0 * Math.sin(a0);
    const x01 = cx + r1 * Math.cos(a0);
    const y01 = cy - r1 * Math.sin(a0);
    const x10 = cx + r0 * Math.cos(a1);
    const y10 = cy - r0 * Math.sin(a1);
    const x11 = cx + r1 * Math.cos(a1);
    const y11 = cy - r1 * Math.sin(a1);
    // SVG sweep flags — a "ring wedge" draws its outer edge along the
    // outer circle bulging AWAY from center, and closes along the inner
    // circle bulging TOWARD center. In SVG's y-down user space:
    //   * outer arc from (x01,y01) at lo to (x11,y11) at hi → sweep=1
    //     so the curve arcs over the top of the cell (convex rim).
    //   * inner arc from (x10,y10) back to (x00,y00) → sweep=0 so it
    //     curves along the smaller circle the same visual direction.
    // The previous code had these inverted, producing cells whose outer
    // edges dipped toward the net (concave) instead of bulging outward.
    return `M ${x00.toFixed(2)} ${y00.toFixed(2)}
            L ${x01.toFixed(2)} ${y01.toFixed(2)}
            A ${r1} ${r1} 0 0 1 ${x11.toFixed(2)} ${y11.toFixed(2)}
            L ${x10.toFixed(2)} ${y10.toFixed(2)}
            A ${r0} ${r0} 0 0 0 ${x00.toFixed(2)} ${y00.toFixed(2)}
            Z`;
  };

  const totalShots = cells.reduce((s, c) => s + c.shots, 0);
  const totalGoals = cells.reduce((s, c) => s + c.goals, 0);
  const totalXG = cells.reduce((s, c) => s + c.xG, 0);
  const totalGAX = totalGoals - totalXG;

  // Find hottest + coldest cells (require ≥4 shots so single-shot lucky
  // bounces don't headline the takeaway).
  const minTakeawayShots = 4;
  const ranked = cells.filter(c => c.shots >= minTakeawayShots);
  const hottest = ranked.length > 0
    ? ranked.reduce((a, b) => (a.residual > b.residual ? a : b))
    : null;
  const coldest = ranked.length > 0
    ? ranked.reduce((a, b) => (a.residual < b.residual ? a : b))
    : null;
  const cellLabel = (c: CellData) =>
    `${ANGLE_BINS[c.angleIdx].label} · ${DIST_BINS[c.distIdx].label} ft`;

  return (
    <div className="hcr">
      {title && <h3 className="hcr-title">{title}</h3>}
      <div className="hcr-sub">
        Each cell = a shot zone (angle from net + distance in feet). Red = converts above expected from there, blue = below.
      </div>
      <div className="hcr-summary">
        <span>{totalShots} shots</span>
        <span className="hcr-sep">·</span>
        <span>{totalGoals} goals</span>
        <span className="hcr-sep">·</span>
        <span>{totalXG.toFixed(1)} xG</span>
        <span className="hcr-sep">·</span>
        <span className={totalGAX >= 0 ? 'hcr-pos' : 'hcr-neg'}>
          {totalGAX >= 0 ? '+' : ''}{totalGAX.toFixed(2)} G−xG
        </span>
      </div>

      {(hottest || coldest) && (
        <div className="hcr-takeaways">
          {hottest && hottest.residual > 0 && (
            <div className="hcr-takeaway hot">
              <span className="hcr-takeaway-label">Hottest zone</span>
              <span className="hcr-takeaway-val">{cellLabel(hottest)}</span>
              <span className="hcr-takeaway-meta">
                {hottest.shots} shots · {hottest.goals} G · xG {hottest.xG.toFixed(1)} ·
                <span className="hcr-pos"> +{hottest.residual.toFixed(2)} G−xG</span>
              </span>
            </div>
          )}
          {coldest && coldest.residual < 0 && (
            <div className="hcr-takeaway cold">
              <span className="hcr-takeaway-label">Coldest zone</span>
              <span className="hcr-takeaway-val">{cellLabel(coldest)}</span>
              <span className="hcr-takeaway-meta">
                {coldest.shots} shots · {coldest.goals} G · xG {coldest.xG.toFixed(1)} ·
                <span className="hcr-neg"> {coldest.residual.toFixed(2)} G−xG</span>
              </span>
            </div>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="hcr-svg"
        role="img"
      >
        {/* Ring guides */}
        {DIST_BINS.map((_, i) => (
          <path
            key={`ring-${i}`}
            d={`M ${cx - rAt(i + 1)} ${cy} A ${rAt(i + 1)} ${rAt(i + 1)} 0 0 1 ${cx + rAt(i + 1)} ${cy}`}
            fill="none"
            stroke="rgba(148,163,184,0.15)"
            strokeDasharray="2 2"
          />
        ))}

        {/* Cells */}
        {cells.map(c => {
          const key = `${c.angleIdx}|${c.distIdx}`;
          const isHovered = hoveredKey === key;
          return (
            <path
              key={key}
              d={arcPath(c.angleIdx, c.distIdx)}
              fill={residualColor(c.residual)}
              opacity={isHovered ? 1 : 0.82}
              stroke={isHovered ? '#fff' : 'rgba(15, 23, 42, 0.5)'}
              strokeWidth={isHovered ? 1.5 : 0.8}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              <title>
                {`${ANGLE_BINS[c.angleIdx].label} · ${DIST_BINS[c.distIdx].label} ft
${c.shots} shots · ${c.goals} goals · xG ${c.xG.toFixed(2)}
Residual: ${c.residual >= 0 ? '+' : ''}${c.residual.toFixed(2)}`}
              </title>
            </path>
          );
        })}

        {/* Net marker */}
        <rect x={cx - 10} y={cy - 3} width={20} height={4}
          fill="#f3f4f6" stroke="#475569" strokeWidth={0.5} />
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10} fill="#94a3b8">NET</text>

        {/* Distance labels on the centerline (straight up from net).
            Small pill backgrounds so the text reads cleanly against
            whatever cell color is behind it. The viewer's eye follows
            the vertical axis from net upward; labels at each ring
            boundary make the radial scale unambiguous. */}
        {DIST_BINS.map((b, i) => {
          const r = rMid(i);
          const y = cy - r + 4;
          const text = `${b.label} ft`;
          const w = text.length * 5.6 + 8;
          return (
            <g key={`dist-${b.label}`}>
              <rect
                x={cx - w / 2}
                y={y - 9}
                width={w}
                height={12}
                rx={6}
                fill="rgba(15, 23, 42, 0.78)"
                stroke="rgba(148, 163, 184, 0.25)"
                strokeWidth={0.5}
              />
              <text
                x={cx}
                y={y}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill="#e2e8f0"
              >{text}</text>
            </g>
          );
        })}

        {/* Angle labels on the outer ring */}
        {ANGLE_BINS.map((b, i) => {
          const mid = (b.lo + b.hi) / 2;
          const a = angleToRadian(mid);
          const r = maxR + 12;
          const x = cx + r * Math.cos(a);
          const y = cy - r * Math.sin(a);
          return (
            <text
              key={`ang-${i}`}
              x={x}
              y={y}
              textAnchor="middle"
              fontSize={10}
              fill="#94a3b8"
            >{b.label}</text>
          );
        })}
      </svg>

      <div className="hcr-legend">
        <span>Cold (under xG)</span>
        <div className="hcr-gradient" />
        <span>Hot (over xG)</span>
      </div>
    </div>
  );
}
