/**
 * Shot Timeline Ribbon
 *
 * A player's season rendered as a single horizontal ribbon — each shot
 * a vertical bar in chronological order. Bar height scales with xG,
 * color indicates result (goal = gold star, saved = slate, missed =
 * light gray, blocked = faint). The eye picks up streaks, dry spells,
 * and xG drift at a glance.
 *
 * Genuinely not a table. Reveals the *shape* of a season.
 */

import { useMemo, useState } from 'react';
import './ShotTimelineRibbon.css';

interface RibbonShot {
  xGoal: number;
  result: 'goal' | 'shot' | 'miss' | 'block';
  gameId?: number;
  gameDate?: string;
}

interface Props {
  shots: RibbonShot[];
  title?: string;
  height?: number;
  width?: number;
}

const RESULT_COLORS: Record<RibbonShot['result'], string> = {
  goal: '#fbbf24',    // gold
  shot: '#94a3b8',    // slate (saved SOG)
  miss: '#475569',    // darker slate (missed net)
  block: '#334155',   // very dim (blocked)
};

export default function ShotTimelineRibbon({ shots, title, height = 140, width = 960 }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  const { ordered, maxXG, gameBoundaries } = useMemo(() => {
    if (!shots || shots.length === 0) {
      return { ordered: [], maxXG: 0.3, gameBoundaries: [] as number[] };
    }
    // Sort by gameDate ascending, stable.
    const ordered = shots.slice().sort((a, b) => {
      const da = a.gameDate ? Date.parse(a.gameDate) : 0;
      const db = b.gameDate ? Date.parse(b.gameDate) : 0;
      return da - db;
    });
    const maxXG = Math.max(0.3, ...ordered.map(s => s.xGoal));
    // Boundaries: index of first shot of each new game.
    const gameBoundaries: number[] = [];
    let prevId: number | null | undefined = undefined;
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].gameId !== prevId) {
        if (i > 0) gameBoundaries.push(i);
        prevId = ordered[i].gameId;
      }
    }
    return { ordered, maxXG, gameBoundaries };
  }, [shots]);

  if (ordered.length === 0) {
    return (
      <div className="str">
        {title && <h3 className="str-title">{title}</h3>}
        <div className="str-empty">No shots to chart yet.</div>
      </div>
    );
  }

  const pad = { top: 20, right: 16, bottom: 32, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xStep = plotW / ordered.length;
  const goals = ordered.reduce((s, sh) => s + (sh.result === 'goal' ? 1 : 0), 0);
  const totalXG = ordered.reduce((s, sh) => s + sh.xGoal, 0);
  const residual = goals - totalXG;
  const first = ordered[0].gameDate;
  const last = ordered[ordered.length - 1].gameDate;

  // Cumulative GAX baseline line: goals-cumulative minus xG-cumulative.
  let cg = 0, cx = 0;
  let maxAbsCum = 0;
  const cumulative: number[] = ordered.map(s => {
    if (s.result === 'goal') cg += 1;
    if (s.result !== 'block') cx += s.xGoal;
    const diff = cg - cx;
    if (Math.abs(diff) > maxAbsCum) maxAbsCum = Math.abs(diff);
    return diff;
  });
  const cumAnchor = Math.max(2, maxAbsCum);

  return (
    <div className="str">
      {title && <h3 className="str-title">{title}</h3>}
      <div className="str-summary">
        <span>{ordered.length} shots</span>
        <span className="str-sep">·</span>
        <span>{goals} goals</span>
        <span className="str-sep">·</span>
        <span>{totalXG.toFixed(1)} xG</span>
        <span className="str-sep">·</span>
        <span className={residual >= 0 ? 'str-pos' : 'str-neg'}>
          {residual >= 0 ? '+' : ''}{residual.toFixed(2)} G−xG
        </span>
      </div>

      <svg width={width} height={height} className="str-svg" role="img">
        {/* Background lane */}
        <rect x={pad.left} y={pad.top} width={plotW} height={plotH}
          fill="rgba(15, 23, 42, 0.4)" rx={4} />
        {/* Zero baseline */}
        <line x1={pad.left} x2={pad.left + plotW}
          y1={pad.top + plotH / 2} y2={pad.top + plotH / 2}
          stroke="rgba(148,163,184,0.3)" strokeDasharray="2 2" />

        {/* Game boundaries */}
        {gameBoundaries.map((b, i) => (
          <line key={`gb-${i}`}
            x1={pad.left + b * xStep} x2={pad.left + b * xStep}
            y1={pad.top} y2={pad.top + plotH}
            stroke="rgba(148,163,184,0.08)" strokeWidth={1}
          />
        ))}

        {/* Shots as bars. Bar extends upward from baseline by xG
            magnitude. Height encodes xG, color encodes result. */}
        {ordered.map((s, i) => {
          const barH = (s.xGoal / maxXG) * (plotH / 2 - 4);
          const x = pad.left + i * xStep + xStep / 2;
          const centerY = pad.top + plotH / 2;
          const topY = centerY - barH;
          const color = RESULT_COLORS[s.result];
          const isHovered = hovered === i;
          return (
            <g key={i}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <rect
                x={x - Math.max(1, xStep * 0.35)} y={topY}
                width={Math.max(1, xStep * 0.7)} height={barH}
                fill={color}
                opacity={s.result === 'block' ? 0.35 : (isHovered ? 1 : 0.85)}
                stroke={isHovered ? '#fff' : 'none'}
                strokeWidth={isHovered ? 0.6 : 0}
              >
                <title>{`${s.gameDate || ''} · xG ${(s.xGoal * 100).toFixed(1)}% · ${s.result}`}</title>
              </rect>
              {s.result === 'goal' && (
                <circle
                  cx={x} cy={topY - 4} r={3.2}
                  fill="#fde68a" stroke="#f59e0b" strokeWidth={0.8}
                />
              )}
            </g>
          );
        })}

        {/* Cumulative G-xG trend overlaid as a faint line */}
        <path
          d={cumulative.map((v, i) => {
            const x = pad.left + i * xStep + xStep / 2;
            const y = pad.top + plotH / 2 - (v / cumAnchor) * (plotH / 2 - 8);
            return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
          }).join(' ')}
          fill="none"
          stroke="rgba(96, 165, 250, 0.85)"
          strokeWidth={1.5}
        />

        {/* Left axis labels */}
        <text x={pad.left - 6} y={pad.top + 10} textAnchor="end"
          fontSize={10} fill="#94a3b8">high xG</text>
        <text x={pad.left - 6} y={pad.top + plotH / 2 + 3} textAnchor="end"
          fontSize={10} fill="#94a3b8">0</text>

        {/* Date range */}
        {first && (
          <text x={pad.left} y={height - 10} textAnchor="start"
            fontSize={10} fill="#94a3b8">{first}</text>
        )}
        {last && (
          <text x={pad.left + plotW} y={height - 10} textAnchor="end"
            fontSize={10} fill="#94a3b8">{last}</text>
        )}
      </svg>

      <div className="str-legend">
        <span><i style={{ background: RESULT_COLORS.goal, border: '1px solid #f59e0b' }} /> Goal</span>
        <span><i style={{ background: RESULT_COLORS.shot }} /> Saved (SOG)</span>
        <span><i style={{ background: RESULT_COLORS.miss }} /> Missed net</span>
        <span><i style={{ background: RESULT_COLORS.block, opacity: 0.35 }} /> Blocked</span>
        <span className="str-line-legend">
          <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#60a5fa" strokeWidth="1.5" /></svg>
          Cumulative G − xG
        </span>
      </div>
    </div>
  );
}
