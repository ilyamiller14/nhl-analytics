/**
 * Rolling Finishing Trajectory
 *
 * Shot-by-shot cumulative (goals − xG) with a gradient fill above/below
 * zero. Shows the finishing trajectory of a season — peaks = hot runs,
 * valleys = cold streaks. The endpoint is the season-total GAX, but the
 * *path* reveals whether the player is regressing up, still cold, or
 * spiking.
 */

import { useMemo } from 'react';
import './RollingFinishingTrajectory.css';

interface ShotInput {
  xGoal: number;
  result: 'goal' | 'shot' | 'miss' | 'block';
  gameDate?: string;
}

interface Props {
  shots: ShotInput[];
  title?: string;
  width?: number;
  height?: number;
}

export default function RollingFinishingTrajectory({
  shots,
  title,
  width = 960,
  height = 220,
}: Props) {
  const { ordered, cum, maxAbs, goals, xG } = useMemo(() => {
    if (!shots || shots.length === 0) {
      return { ordered: [], cum: [] as number[], maxAbs: 1, goals: 0, xG: 0 };
    }
    const ordered = shots.slice().sort((a, b) => {
      const da = a.gameDate ? Date.parse(a.gameDate) : 0;
      const db = b.gameDate ? Date.parse(b.gameDate) : 0;
      return da - db;
    });
    let g = 0, xg = 0, maxAbs = 0;
    const cum: number[] = [];
    for (const s of ordered) {
      if (s.result === 'goal') g += 1;
      if (s.result !== 'block') xg += s.xGoal;
      const v = g - xg;
      cum.push(v);
      if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
    return { ordered, cum, maxAbs: Math.max(1, maxAbs), goals: g, xG: xg };
  }, [shots]);

  if (ordered.length === 0) {
    return (
      <div className="rft">
        {title && <h3 className="rft-title">{title}</h3>}
        <div className="rft-empty">No shot history yet.</div>
      </div>
    );
  }

  const pad = { top: 20, right: 16, bottom: 34, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xStep = plotW / (ordered.length - 1 || 1);
  const zeroY = pad.top + plotH / 2;
  const yScale = (v: number) => zeroY - (v / maxAbs) * (plotH / 2 - 6);

  // Build path
  const pathD = cum.map((v, i) => {
    const x = pad.left + i * xStep;
    const y = yScale(v);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  // Area fills: one path closed down to zero line per run of signed
  // values. We split into segments at zero-crossings for crisp coloring.
  const segments: { points: Array<{ x: number; y: number }>; positive: boolean }[] = [];
  let cur: { points: Array<{ x: number; y: number }>; positive: boolean } | null = null;
  for (let i = 0; i < cum.length; i++) {
    const v = cum[i];
    const x = pad.left + i * xStep;
    const y = yScale(v);
    const pos = v >= 0;
    if (!cur || cur.positive !== pos) {
      // Close previous segment at baseline
      if (cur) cur.points.push({ x, y: zeroY });
      cur = { points: [{ x, y: zeroY }, { x, y }], positive: pos };
      segments.push(cur);
    } else {
      cur.points.push({ x, y });
    }
  }
  if (cur) cur.points.push({ x: pad.left + (cum.length - 1) * xStep, y: zeroY });

  const residual = cum[cum.length - 1] ?? 0;
  const endDate = ordered[ordered.length - 1]?.gameDate;
  const startDate = ordered[0]?.gameDate;

  // Period gridlines every 10 shots if sample long enough.
  const tickStride = Math.max(5, Math.floor(ordered.length / 8));

  return (
    <div className="rft">
      {title && <h3 className="rft-title">{title}</h3>}
      <div className="rft-summary">
        <span>{ordered.length} shots · {goals} goals · {xG.toFixed(1)} xG</span>
        <span className="rft-sep">·</span>
        <span className={residual >= 0 ? 'rft-pos' : 'rft-neg'}>
          current G − xG: {residual >= 0 ? '+' : ''}{residual.toFixed(2)}
        </span>
      </div>

      <svg width={width} height={height} className="rft-svg" role="img">
        <defs>
          <linearGradient id="rft-grad-pos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(52, 211, 153, 0.55)" />
            <stop offset="100%" stopColor="rgba(52, 211, 153, 0.05)" />
          </linearGradient>
          <linearGradient id="rft-grad-neg" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="rgba(248, 113, 113, 0.55)" />
            <stop offset="100%" stopColor="rgba(248, 113, 113, 0.05)" />
          </linearGradient>
        </defs>

        {/* Gridlines at every tickStride */}
        {Array.from({ length: Math.floor(ordered.length / tickStride) + 1 }, (_, k) => {
          const i = k * tickStride;
          if (i >= ordered.length) return null;
          const x = pad.left + i * xStep;
          return (
            <line key={`g-${k}`} x1={x} x2={x} y1={pad.top} y2={pad.top + plotH}
              stroke="rgba(148,163,184,0.08)" />
          );
        })}

        {/* Zero baseline */}
        <line x1={pad.left} x2={pad.left + plotW} y1={zeroY} y2={zeroY}
          stroke="rgba(148,163,184,0.5)" strokeDasharray="3 3" />

        {/* Area fills */}
        {segments.map((seg, i) => {
          const d = 'M ' + seg.points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ') + ' Z';
          return (
            <path key={`seg-${i}`} d={d}
              fill={seg.positive ? 'url(#rft-grad-pos)' : 'url(#rft-grad-neg)'} />
          );
        })}

        {/* Main line */}
        <path d={pathD} fill="none" stroke="#e2e8f0" strokeWidth={1.8} strokeLinejoin="round" />

        {/* Y axis labels */}
        <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" fontSize={10} fill="#34d399">+{maxAbs.toFixed(1)}</text>
        <text x={pad.left - 6} y={zeroY + 3} textAnchor="end" fontSize={10} fill="#94a3b8">0</text>
        <text x={pad.left - 6} y={pad.top + plotH - 2} textAnchor="end" fontSize={10} fill="#f87171">−{maxAbs.toFixed(1)}</text>

        {/* Bottom date markers */}
        {startDate && (
          <text x={pad.left} y={height - 8} textAnchor="start" fontSize={10} fill="#94a3b8">{startDate}</text>
        )}
        {endDate && (
          <text x={pad.left + plotW} y={height - 8} textAnchor="end" fontSize={10} fill="#94a3b8">{endDate}</text>
        )}
        <text x={pad.left + plotW / 2} y={height - 8} textAnchor="middle" fontSize={10} fill="#94a3b8">shot # →</text>

        {/* Y axis title */}
        <text x={14} y={pad.top + plotH / 2} textAnchor="middle" fontSize={11} fill="#cbd5f5"
          transform={`rotate(-90 14 ${pad.top + plotH / 2})`}>Cumulative G − xG</text>
      </svg>

      <p className="rft-caption">
        Line above zero (green) = this player has finished above the model's expectation to date.
        Below zero (red) = regression pending, or true under-finisher.
      </p>
    </div>
  );
}
