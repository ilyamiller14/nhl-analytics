/**
 * Goalie WAR Breakdown — sibling to WARBreakdown.tsx, tuned for the
 * 4-segment goalie decomposition produced by computeGoalieWAR:
 *
 *   savePerformance + workloadBonus + shrinkageAdjust + replacementAdjust = WAR
 *
 * Why a separate file vs reusing WARBreakdown:
 *   - WARBreakdown's segments are skater-shaped (finishing, playmaking,
 *     EV off/def, PP/PK, faceoffs, turnovers, discipline, replacement).
 *     Goalies have none of those — silently rendering a skater chart for
 *     a goalie produces confusing zero-bars.
 *   - The "goals UNDER expected" headline (GSAx) is the load-bearing
 *     analytics number for goalies; the chart explicitly labels the
 *     savePerformance row "Save Performance (GSAx)" and surfaces the
 *     cumulative GSAx number above the chart.
 *   - With only 4 segments + Total, the rowHeight bumps up so the chart
 *     fills its allotted vertical space in the share card without
 *     looking sparse against the dense skater version.
 *
 * Visual language is otherwise identical to WARBreakdown:
 *   - sign-driven diverging colors (red = negative, green = positive)
 *   - divergent bars from a zero axis, value labels outside the bar end
 *   - compact mode toggle for the share-card slot
 */

import type { GoalieWARResult } from '../../services/warService';
import './WARBreakdown.css';

interface Props {
  result: GoalieWARResult;
  title?: string;
  playerName?: string;
  width?: number;
  /** Compact mode: tighter padding + larger fonts so the chart reads
   *  inside the share card's bounded 600px-tall bottom slot. */
  compact?: boolean;
}

const BAR_COLORS = {
  positive: '#34d399',
  negative: '#f87171',
  neutral: 'rgba(148, 163, 184, 0.6)',
} as const;

function colorForValue(value: number, isReplacement = false): string {
  if (isReplacement) return BAR_COLORS.neutral;
  if (value > 0.01) return BAR_COLORS.positive;
  if (value < -0.01) return BAR_COLORS.negative;
  return BAR_COLORS.neutral;
}

interface Segment {
  key: 'savePerformance' | 'workloadBonus' | 'shrinkageAdjust' | 'replacementAdjust';
  label: string;
  value: number;            // wins (already converted from goals)
  desc: string;             // tooltip body
  sourceLabel: string;      // source line in tooltip
  isReplacement?: boolean;
}

function fmt(n: number, d = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;
}

export default function GoalieWARBreakdown({
  result,
  title,
  playerName,
  width = 720,
  compact = false,
}: Props) {
  if (result.gamesPlayed === 0) {
    return (
      <div className="war-break">
        {title && <h3 className="war-title">{title}</h3>}
        <div className="war-empty">
          {result.notes.length > 0 ? result.notes[0] : 'No games played yet.'}
        </div>
      </div>
    );
  }

  const c = result.components;
  const s = result.sources;

  // Segments are already in WIN units (computeGoalieWAR converts them
  // by dividing by marginalGoalsPerWin). The chart axis is "wins"; no
  // further /goalsPerWin conversion needed.
  const segments: Segment[] = [
    {
      key: 'savePerformance',
      label: 'Save Performance (GSAx)',
      value: c.savePerformance,
      desc:
        'Goals saved above expected (GSAx) in win-units. ' +
        'Computed as (xG-faced − goals-allowed) / goals-per-win. ' +
        'This is the headline goalie analytics metric — positive = the ' +
        'goalie has stopped MORE shots than the league xG model expected.',
      sourceLabel: '(xGFaced − goalsAllowed) / marginalGoalsPerWin',
    },
    {
      key: 'workloadBonus',
      label: 'Workload bonus',
      value: c.workloadBonus,
      desc:
        'Above-median GSAx-per-game × games played, in win-units. ' +
        'Rewards goalies who combine elite per-game GSAx with a starter\'s ' +
        'workload. Negative when a goalie is below the league median rate.',
      sourceLabel: '(gsaxPerGame − leagueMedianGsaxPerGame) × games / mGW',
    },
    {
      key: 'shrinkageAdjust',
      label: 'GSAx vs replacement (regressed by shots-faced sample)',
      value: c.shrinkageAdjust,
      desc:
        'Algebraic offset that cancels the workload bonus so the four ' +
        'components sum to the same WAR a simple (savePerformance + ' +
        'replacementAdjust) two-term formula produces. Visualizes how ' +
        'much of the workload bonus is a re-statement of GSAx.',
      sourceLabel: '−workloadBonus (algebraic identity)',
    },
    {
      key: 'replacementAdjust',
      label: 'vs replacement',
      value: c.replacementAdjust,
      desc:
        `Replacement = ${s.replacementGSAxPerGame.toFixed(3)} GSAx/game ` +
        `(13th-percentile starter-cohort). Subtracting × games anchors ` +
        `the metric above replacement-level — every working NHL goalie ` +
        `clears this bar by some margin.`,
      sourceLabel: '−replacementGSAxPerGame × games / mGW',
      isReplacement: true,
    },
  ];

  const segValuesWin = segments.map(seg => seg.value);

  // 82-GP pace projection — same as the skater chart but on goalie
  // shots-stabilized WAR. Only shown for partial-season goalies.
  const SHOW_PROJECTION = result.gamesPlayed > 0 && result.gamesPlayed < 60; // goalies hit ~60 starts cap
  const paceMult = result.gamesPlayed > 0 ? 82 / result.gamesPlayed : 0;
  const segValuesProj = segments.map((_, i) =>
    SHOW_PROJECTION ? segValuesWin[i] * paceMult : 0);

  const maxAbs = Math.max(
    0.05,
    ...segValuesWin.map(v => Math.abs(v)),
    ...(SHOW_PROJECTION ? segValuesProj.map(v => Math.abs(v)) : []),
    Math.abs(result.WAR),
    SHOW_PROJECTION ? Math.abs(result.WAR_per_82) : 0,
  );

  // pad.left 250 in compact mode — the "Save Performance (GSAx)" and
  // "GSAx vs replacement (regressed by shots-faced sample)" labels are
  // long; without enough left pad they wrap underneath the bar and the
  // numeric values overlap.
  const pad = compact
    ? { top: 14, right: 36, bottom: 18, left: 250 }
    : { top: 24, right: 44, bottom: 34, left: 270 };
  const plotW = width - pad.left - pad.right;
  const zeroX = pad.left + plotW / 2;
  const pxPerWin = plotW / 2 / maxAbs;

  // Bumped row heights — fewer segments than the skater chart, so each
  // row gets more vertical real estate. compact 56 / 72 fills the
  // ~600px-tall share-card bottom slot evenly.
  const rowHeight = compact ? 56 : 50;
  const rowGap = compact ? 8 : 8;
  const extraRows = compact ? 38 : 60;
  const height = pad.top + segments.length * (rowHeight + rowGap) + extraRows + pad.bottom;

  const warClass = result.WAR_per_82 > 0.5 ? 'pos' : result.WAR_per_82 < 0 ? 'neg' : 'neutral';
  const gsaxClass = result.GSAx > 0 ? 'pos' : result.GSAx < 0 ? 'neg' : 'neutral';

  return (
    <div className="war-break">
      {title && <h3 className="war-title">{title}</h3>}

      {/* GSAx prominent headline — the goals-under-expected number is
          THE goalie analytics metric. Surfacing it above the chart
          makes the connection between savePerformance bar and GSAx
          explicit for the reader. */}
      <div className="war-headline goalie-war-headline">
        <div className={`war-number ${gsaxClass}`}>
          <span className="war-value">{fmt(result.GSAx)}</span>
          <span className="war-unit">GSAx · {result.gamesPlayed} GP</span>
          <span className="war-pace-sub">
            {fmt(result.gsaxPer60, 2)} per 60 · {result.shotsFaced} shots faced
          </span>
        </div>
        <div className="war-meta">
          <div>
            <span className="war-label">82-GP WAR pace</span>
            <span className={`war-pace ${warClass}`}>{result.WAR_per_82.toFixed(2)}</span>
          </div>
          <div>
            <span className="war-label">Cumulative WAR</span>
            <span className="war-pace">{result.WAR.toFixed(2)}</span>
          </div>
          <div>
            <span className="war-label">Percentile (G)</span>
            <span className={`war-pct ${warClass}`}>
              {result.percentile.toFixed(0)} · {result.percentileLabel}
            </span>
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="war-svg"
        role="img"
      >
        <line x1={zeroX} x2={zeroX}
          y1={pad.top}
          y2={pad.top + segments.length * (rowHeight + rowGap) + extraRows - 14}
          stroke="rgba(148,163,184,0.5)" strokeDasharray="3 3" />
        <text x={zeroX} y={pad.top - 8} textAnchor="middle" fontSize={10} fill="#94a3b8">0</text>

        <text x={pad.left + 8} y={pad.top - 8} textAnchor="start" fontSize={10} fill="#f87171">
          ← costs wins
        </text>
        <text x={pad.left + plotW - 8} y={pad.top - 8} textAnchor="end" fontSize={10} fill="#34d399">
          earns wins →
        </text>

        {segments.map((seg, i) => {
          const wins = segValuesWin[i];
          const winsProj = segValuesProj[i];
          const y = pad.top + 14 + i * (rowHeight + rowGap);
          const cumAbs = Math.abs(wins);
          const projAbs = Math.abs(winsProj);
          const deltaAbs = Math.max(0, projAbs - cumAbs);
          const sign = wins > 0 ? 1 : wins < 0 ? -1 : (winsProj >= 0 ? 1 : -1);
          const cumW = cumAbs * pxPerWin;
          const deltaW = deltaAbs * pxPerWin;
          const barStartX = sign >= 0 ? zeroX : zeroX - cumW;
          const deltaStartX = sign >= 0 ? zeroX + cumW : zeroX - cumW - deltaW;
          return (
            <g key={seg.key}>
              {/* Long labels — Save Performance (GSAx) and GSAx vs
                  replacement — wrap to two lines in the limited left
                  pad. Use a foreignObject? No — html-to-image's SVG
                  capture is reliable on <text> with multiple <tspan>
                  rows but flaky on foreignObject. Keep text + tspan. */}
              {(() => {
                const labelLines = wrapLabel(seg.label, 30);
                const lineH = compact ? 14 : 14;
                const startY = y + rowHeight / 2 - ((labelLines.length - 1) * lineH) / 2 + (compact ? 4 : 4);
                return (
                  <text x={pad.left - 10}
                    textAnchor="end"
                    fontSize={compact ? 13 : 12}
                    fill="#cbd5f5">
                    {labelLines.map((line, li) => (
                      <tspan key={li} x={pad.left - 10} y={startY + li * lineH}>{line}</tspan>
                    ))}
                  </text>
                );
              })()}
              {/* Cumulative bar */}
              <rect x={barStartX} y={y} width={Math.max(cumW, 1)} height={rowHeight}
                fill={colorForValue(wins, seg.isReplacement)}
                opacity={cumAbs === 0 ? 0.25 : 0.9} rx={2}>
                <title>
                  {`${seg.label}
Cumulative: ${fmt(wins)} wins · ${result.gamesPlayed} GP
${SHOW_PROJECTION ? `82-GP pace: ${fmt(winsProj)} wins (×${paceMult.toFixed(2)})` : ''}
${seg.desc}
source: ${seg.sourceLabel}`}
                </title>
              </rect>
              {/* Pace tick at projected 82-GP endpoint */}
              {SHOW_PROJECTION && deltaW > 0 && (
                <line
                  x1={deltaStartX + deltaW}
                  x2={deltaStartX + deltaW}
                  y1={y - 3}
                  y2={y + rowHeight + 3}
                  stroke={colorForValue(winsProj, seg.isReplacement)}
                  strokeWidth={2}
                  strokeDasharray="2 2"
                  opacity={0.85}
                />
              )}
              {/* Value label — same collision logic as WARBreakdown.tsx */}
              {(() => {
                const valueTextWidth = 50;
                const outsideX = sign >= 0 ? barStartX + cumW + 6 : barStartX - 6;
                const collidesLeft = sign < 0 && (outsideX - valueTextWidth) < pad.left + 4;
                const collidesRight = sign > 0 && (outsideX + valueTextWidth) > pad.left + plotW;
                const inside = collidesLeft || collidesRight;
                const insideX = sign >= 0 ? barStartX + cumW - 6 : barStartX + 6;
                return (
                  <text x={inside ? insideX : outsideX}
                    y={y + rowHeight / 2 + 5}
                    textAnchor={inside ? (sign >= 0 ? 'end' : 'start') : (sign >= 0 ? 'start' : 'end')}
                    fontSize={compact ? 16 : 14}
                    fill={inside ? '#0f172a' : (wins > 0 ? '#34d399' : wins < 0 ? '#f87171' : '#64748b')}
                    fontWeight={700}>
                    {fmt(wins)}
                  </text>
                );
              })()}
            </g>
          );
        })}

        {/* Total WAR row */}
        {(() => {
          const y = pad.top + 14 + segments.length * (rowHeight + rowGap) + 8;
          const cum = result.WAR;
          const proj = result.WAR_per_82;
          const cumAbs = Math.abs(cum);
          const projAbs = Math.abs(proj);
          const deltaAbs = Math.max(0, projAbs - cumAbs);
          const sign = cum > 0 ? 1 : cum < 0 ? -1 : (proj >= 0 ? 1 : -1);
          const cumW = cumAbs * pxPerWin;
          const deltaW = deltaAbs * pxPerWin;
          const barStartX = sign >= 0 ? zeroX : zeroX - cumW;
          const deltaStartX = sign >= 0 ? zeroX + cumW : zeroX - cumW - deltaW;
          const posColor = '#10b981';
          const negColor = '#dc2626';
          const mainColor = sign >= 0 ? posColor : negColor;
          return (
            <g>
              <line x1={pad.left - 20} x2={pad.left + plotW}
                y1={y - 4} y2={y - 4}
                stroke="rgba(148, 163, 184, 0.3)" />
              <text x={pad.left - 10} y={y + rowHeight / 2 + (compact ? 6 : 5)}
                textAnchor="end" fontSize={compact ? 17 : 14} fill="#f3f4f6" fontWeight={700}>
                Total WAR
              </text>
              <rect x={barStartX} y={y} width={Math.max(cumW, 1)} height={rowHeight}
                fill={mainColor} rx={2}>
                <title>
                  {`Total WAR — cumulative: ${fmt(cum)} wins · 82-GP pace: ${fmt(proj)} wins`}
                </title>
              </rect>
              {SHOW_PROJECTION && deltaW > 0 && (
                <line
                  x1={deltaStartX + deltaW}
                  x2={deltaStartX + deltaW}
                  y1={y - 3}
                  y2={y + rowHeight + 3}
                  stroke={mainColor}
                  strokeWidth={2}
                  strokeDasharray="2 2"
                  opacity={0.9}
                />
              )}
              <text x={sign >= 0 ? barStartX + cumW + 6 : barStartX - 6}
                y={y + rowHeight / 2 + (compact ? 7 : 5)}
                textAnchor={sign >= 0 ? 'start' : 'end'}
                fontSize={compact ? 18 : 15}
                fill={mainColor === posColor ? '#34d399' : '#f87171'}
                fontWeight={700}>
                {fmt(cum)}
              </text>
            </g>
          );
        })()}

        {/* Tick marks */}
        {[-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs].map((t, i) => {
          const x = zeroX + t * pxPerWin;
          const yAxis = height - pad.bottom + 4;
          return (
            <g key={`tick-${i}`}>
              <line x1={x} x2={x} y1={yAxis - 6} y2={yAxis} stroke="rgba(148,163,184,0.4)" />
              <text x={x} y={yAxis + 12} textAnchor="middle" fontSize={10} fill="#94a3b8">
                {t >= 0 ? '+' : ''}{t.toFixed(2)}
              </text>
            </g>
          );
        })}

        {!compact && (
          <text x={pad.left + plotW / 2} y={height - 4} textAnchor="middle"
            fontSize={10} fill="#94a3b8">
            Goalie WAR — components sum to {result.WAR.toFixed(2)} (mGW = {s.marginalGoalsPerWin.toFixed(2)})
          </text>
        )}
      </svg>

      {result.notes.length > 0 && (
        <ul className="war-notes">
          {result.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      <p className="war-footer">
        All inputs from this season ({s.season}):
        {' '}marginal goals/win = {s.marginalGoalsPerWin.toFixed(2)} (Pythagorean) ·
        {' '}replacement = {s.replacementGSAxPerGame.toFixed(3)} GSAx/game ·
        {' '}league-median = {s.leagueMedianGSAxPerGame.toFixed(3)} GSAx/game.
        {playerName ? ` · ${playerName}` : ''}
      </p>
    </div>
  );
}

// Greedy word-wrap helper — splits a long label at word boundaries so
// long row labels fit inside the chart's left padding without
// overflowing into the bar area.
function wrapLabel(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur += ' ' + w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
