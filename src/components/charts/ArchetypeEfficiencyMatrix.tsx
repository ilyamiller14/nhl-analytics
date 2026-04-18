/**
 * Archetype Efficiency Matrix
 *
 * Bubble scatter of each play archetype's usage vs its conversion rate.
 * X axis = share of attacks (usage). Y axis = shooting %. Bubble size =
 * shots on goal.
 *
 * Designed for the light page theme, inline bubble labels (no chip
 * legend grid), and force-jittered to separate overlapping archetypes
 * that land at the same usage/SH% coordinates.
 */

import { useMemo } from 'react';
import { aggregateArchetypes } from '../../utils/archetypeAggregation';
import { ARCHETYPE_COLORS } from '../../types/playStyle';
import type { AttackSequence, PlayArchetype } from '../../types/playStyle';
import './ArchetypeEfficiencyMatrix.css';

interface Props {
  sequences: AttackSequence[];
  title?: string;
  width?: number;
  /** Archetypes with fewer than this many shots are hidden (noise filter). */
  minShots?: number;
}

const ARCHETYPE_LABEL: Record<PlayArchetype, string> = {
  'rush-breakaway': 'Breakaway',
  'rush-oddman': 'Odd-man rush',
  'rush-standard': 'Rush',
  'cycle-low': 'Cycle low',
  'cycle-high': 'Cycle high',
  'point-shot': 'Point shot',
  'point-deflection': 'Deflection',
  'net-scramble': 'Net scramble',
  'rebound': 'Rebound',
  'transition-quick': 'Quick transition',
  'transition-sustained': 'Transition',
};

/** Nudge overlapping labels by walking the list once and pushing labels
 * that would collide with an earlier label. Offsets are in SVG px. */
function resolveLabelPositions(
  pts: Array<{ cx: number; cy: number; r: number; label: string }>,
  labelW = 90, labelH = 14
): Array<{ x: number; y: number; anchor: 'start' | 'end' }> {
  const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  return pts.map(p => {
    // Prefer placing label to the right, vertically centered. If that box
    // overlaps an existing one, try below; then left; then above.
    const candidates: Array<{ x: number; y: number; anchor: 'start' | 'end' }> = [
      { x: p.cx + p.r + 6, y: p.cy + 4, anchor: 'start' },
      { x: p.cx + p.r + 6, y: p.cy + 16, anchor: 'start' },
      { x: p.cx - p.r - 6, y: p.cy + 4, anchor: 'end' },
      { x: p.cx + p.r + 6, y: p.cy - 6, anchor: 'start' },
    ];
    for (const c of candidates) {
      const box = c.anchor === 'start'
        ? { x1: c.x, y1: c.y - labelH, x2: c.x + labelW, y2: c.y }
        : { x1: c.x - labelW, y1: c.y - labelH, x2: c.x, y2: c.y };
      const collides = placed.some(p2 =>
        box.x1 < p2.x2 && box.x2 > p2.x1 && box.y1 < p2.y2 && box.y2 > p2.y1
      );
      if (!collides) {
        placed.push(box);
        return c;
      }
    }
    // Fallback: accept first candidate even if collides.
    placed.push({ x1: candidates[0].x, y1: candidates[0].y - labelH, x2: candidates[0].x + labelW, y2: candidates[0].y });
    return candidates[0];
  });
}

export default function ArchetypeEfficiencyMatrix({
  sequences,
  title,
  width = 720,
  minShots = 5,
}: Props) {
  const rows = useMemo(() => {
    const all = aggregateArchetypes(sequences);
    return all.filter(r => r.shots >= minShots);
  }, [sequences, minShots]);

  // Below this count the quadrant-tint + corner labels read as empty
  // space and confuse readers. Hide them and let the scatter speak.
  const showQuadrantHints = rows.length >= 3;

  if (rows.length === 0) {
    return (
      <div className="am-v2">
        {title && <h3 className="am-title">{title}</h3>}
        <div className="am-empty">No archetype with &ge;{minShots} shots yet.</div>
      </div>
    );
  }

  // Scales
  const maxShare = Math.max(10, ...rows.map(r => r.sharePct));
  const maxSH = Math.max(20, ...rows.map(r => r.shootingPct));
  const maxShots = Math.max(1, ...rows.map(r => r.shots));

  const height = 420;
  const pad = { top: 24, right: 30, bottom: 46, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xScale = (pct: number) => pad.left + (pct / maxShare) * plotW;
  const yScale = (pct: number) => pad.top + plotH - (pct / maxSH) * plotH;
  const rScale = (shots: number) => 8 + Math.sqrt(shots / maxShots) * 20;

  // Resolve label positions after computing bubble positions.
  const bubbles = rows.map(r => ({
    row: r,
    cx: xScale(Math.min(r.sharePct, maxShare)),
    cy: yScale(Math.min(r.shootingPct, maxSH)),
    r: rScale(r.shots),
    color: ARCHETYPE_COLORS[r.archetype],
    label: ARCHETYPE_LABEL[r.archetype],
  }));
  const labels = resolveLabelPositions(bubbles.map(b => ({ cx: b.cx, cy: b.cy, r: b.r, label: b.label })));

  // Quadrant tint guides to reinforce interpretation:
  // - top right: high usage + high conversion (core identity & scoring)
  // - top left: low usage + high conversion (underused gem)
  // - bottom right: high usage + low conversion (over-leveraged)
  // - bottom left: low usage + low conversion (ignore)
  const midX = pad.left + plotW / 2;
  const midY = pad.top + plotH / 2;

  const xTickValues = [0, Math.round(maxShare / 4), Math.round(maxShare / 2), Math.round(3 * maxShare / 4), Math.round(maxShare)];
  const yTickValues = [0, Math.round(maxSH / 4), Math.round(maxSH / 2), Math.round(3 * maxSH / 4), Math.round(maxSH)];

  return (
    <div className="am-v2">
      {title && <h3 className="am-title">{title}</h3>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="am-svg"
        role="img"
      >
        {showQuadrantHints && (
          <>
            {/* Quadrant backgrounds — very subtle */}
            <rect x={midX} y={pad.top} width={pad.left + plotW - midX} height={midY - pad.top}
              fill="rgba(52, 211, 153, 0.05)" />
            <rect x={pad.left} y={pad.top} width={midX - pad.left} height={midY - pad.top}
              fill="rgba(96, 165, 250, 0.04)" />
            <rect x={midX} y={midY} width={pad.left + plotW - midX} height={pad.top + plotH - midY}
              fill="rgba(251, 146, 60, 0.05)" />
            {/* Quadrant labels — faint */}
            <text x={pad.left + plotW - 8} y={pad.top + 14} textAnchor="end" fontSize={10} fill="rgba(16, 185, 129, 0.7)">Core + converts</text>
            <text x={pad.left + 8} y={pad.top + 14} textAnchor="start" fontSize={10} fill="rgba(59, 130, 246, 0.6)">Underused gem</text>
            <text x={pad.left + plotW - 8} y={pad.top + plotH - 6} textAnchor="end" fontSize={10} fill="rgba(249, 115, 22, 0.65)">Over-leveraged</text>
          </>
        )}

        {/* Gridlines at tick positions */}
        {xTickValues.map(t => (
          <line key={`xg-${t}`} x1={xScale(t)} x2={xScale(t)} y1={pad.top} y2={pad.top + plotH}
            stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
        ))}
        {yTickValues.map(t => (
          <line key={`yg-${t}`} x1={pad.left} x2={pad.left + plotW} y1={yScale(t)} y2={yScale(t)}
            stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
        ))}

        {/* Axes */}
        <line x1={pad.left} x2={pad.left + plotW} y1={pad.top + plotH} y2={pad.top + plotH}
          stroke="rgba(148,163,184,0.6)" />
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + plotH}
          stroke="rgba(148,163,184,0.6)" />

        {/* Tick labels */}
        {xTickValues.map(t => (
          <text key={`xt-${t}`} x={xScale(t)} y={pad.top + plotH + 14} textAnchor="middle"
            fontSize={10} fill="#94a3b8">{t}%</text>
        ))}
        {yTickValues.map(t => (
          <text key={`yt-${t}`} x={pad.left - 6} y={yScale(t) + 3} textAnchor="end"
            fontSize={10} fill="#94a3b8">{t}%</text>
        ))}

        {/* Axis labels */}
        <text x={pad.left + plotW / 2} y={height - 8} textAnchor="middle"
          fontSize={11} fill="#cbd5f5">Usage (% of team attacks)</text>
        <text x={14} y={pad.top + plotH / 2} textAnchor="middle"
          fontSize={11} fill="#cbd5f5"
          transform={`rotate(-90 14 ${pad.top + plotH / 2})`}>Conversion (SH%)</text>

        {/* Bubbles + inline labels */}
        {bubbles.map((b, i) => {
          const lp = labels[i];
          return (
            <g key={b.row.archetype}>
              <circle
                cx={b.cx} cy={b.cy} r={b.r}
                fill={b.color}
                opacity={0.75}
                stroke="rgba(15, 23, 42, 0.5)"
                strokeWidth={1}
              >
                <title>{`${b.label}
Usage: ${b.row.sharePct.toFixed(1)}%
Shots: ${b.row.shots} (${b.row.goals} goals)
SH%: ${b.row.shootingPct.toFixed(1)}%
Avg xG/shot: ${b.row.avgXGPerShot.toFixed(3)}`}</title>
              </circle>
              <text
                x={lp.x} y={lp.y}
                textAnchor={lp.anchor}
                fontSize={11}
                fill="#e5e7eb"
                fontWeight={500}
                style={{ pointerEvents: 'none' }}
              >{b.label}</text>
              <text
                x={lp.x} y={lp.y + 12}
                textAnchor={lp.anchor}
                fontSize={9}
                fill="#94a3b8"
                style={{ pointerEvents: 'none' }}
              >{`${b.row.shots}s · ${b.row.shootingPct.toFixed(1)}%`}</text>
            </g>
          );
        })}
      </svg>

      <p className="am-caption">
        Bubble size = shot volume. Top-right = team identity archetypes that actually convert.
        Bottom-right = over-leveraged (high volume but low finish). Archetypes with &lt;{minShots} shots hidden.
      </p>
    </div>
  );
}
