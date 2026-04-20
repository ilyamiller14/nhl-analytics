/**
 * WAR Breakdown — horizontal divergent bar showing a player's
 * Goals-Above-Replacement decomposition, with a league-derived
 * percentile placement and data-sourcing transparency.
 *
 * Every value is traceable to a named source artifact. The footer
 * surfaces those sources so a viewer can interrogate the number.
 */

import type { WARResult } from '../../services/warService';
import './WARBreakdown.css';

interface Props {
  result: WARResult;
  title?: string;
  playerName?: string;
  width?: number;
  /** When true, the SVG + headline render at reduced natural height
   *  (smaller rows, tighter padding, no axis label row) so the full
   *  breakdown fits inside a share-card-style bounded container
   *  without relying on CSS overflow clipping (which html-to-image
   *  ignores during export). */
  compact?: boolean;
}

// Distinct colors per domain:
//   green/cyan  → individual offense
//   teal/rose   → on-ice offense / defense
//   purple      → special teams (faceoffs)
//   slate       → micro (hits/blocks)
//   red/gray    → turnovers / replacement
//   gold        → discipline (penalties)
const SEGMENT_COLORS = {
  finishing: '#34d399',       // green  — individual finishing (GAX)
  playmaking: '#38bdf8',      // cyan   — primary-assist setup value
  evOffense: '#2dd4bf',       // teal   — on-ice xGF vs league median
  evDefense: '#fb7185',       // rose   — on-ice xGA vs league median
  faceoffs: '#a855f7',        // purple — special-teams / faceoffs
  turnovers: '#f97316',       // orange — takeaways − giveaways
  micro: '#94a3b8',           // slate  — hits + shot blocks
  penalties: '#fbbf24',       // gold   — discipline
  replacement: 'rgba(148, 163, 184, 0.65)', // gray — replacement floor
} as const;

type ComponentKey = keyof WARResult['components'];

interface Segment {
  key: ComponentKey | 'replacement';
  label: string;
  value: number;
  color: string;
  desc: string;
  // Zero-valued segments render dimmed and carry a "data-pending" pill.
  // A segment is "pending" when the upstream league-context input wasn't
  // populated yet — distinct from a real zero (no primary assists, etc).
  pending: boolean;
  sourceLabel: string;
}

function fmt(n: number, d = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;
}

export default function WARBreakdown({ result, title, playerName, width = 720, compact = false }: Props) {
  if (!result.dataComplete || result.gamesPlayed === 0) {
    return (
      <div className="war-break">
        {title && <h3 className="war-title">{title}</h3>}
        <div className="war-empty">
          {result.notes.length > 0 ? result.notes[0] : 'Insufficient data.'}
        </div>
      </div>
    );
  }

  const s = result.sources;
  const c = result.components;

  const evOffPending = s.medianOnIceXGF60 == null;
  const evDefPending = s.medianOnIceXGA60 == null;
  const faceoffPending = s.faceoffValuePerWin == null;
  const turnoverPending = s.takeawayGoalValue == null || s.giveawayGoalValue == null;

  const rawSegments: Segment[] = [
    {
      key: 'finishing',
      label: 'Finishing (G − xG)',
      value: c.finishing,
      color: SEGMENT_COLORS.finishing,
      desc: 'Shooting skill above expected: iG − ixG on shots taken. This credits CONVERSION skill only — taking many shots at league-average rate scores 0 here. Volume scoring shows up under EV Offense via RAPM\'s on-ice xGF coefficient (which includes this player\'s own shot contribution).',
      pending: false,
      sourceLabel: 'from iG / ixG on shots taken',
    },
    {
      key: 'playmaking',
      label: 'Playmaking',
      value: c.playmaking,
      color: SEGMENT_COLORS.playmaking,
      desc: `Primary assists × league median ixG/60 (${s.leagueMedianGARPerGame.toFixed(2)} league-median GAR/game anchor, ${result.position})`,
      pending: false,
      sourceLabel: `league median ixG/60 for ${result.position}`,
    },
    {
      key: 'evOffense',
      label: 'EV offense (on-ice)',
      value: c.evOffense,
      color: SEGMENT_COLORS.evOffense,
      desc: evOffPending
        ? 'Pending: median on-ice xGF/60 missing from league_context.'
        : `(player on-ice xGF/60 − team off-ice xGF/60) × EV-hours × 1/5 (skater share — line credit split among 5 skaters)`,
      pending: evOffPending,
      sourceLabel: 'league_context.medianOnIceXGF60',
    },
    {
      key: 'evDefense',
      label: 'EV defense (on-ice)',
      value: c.evDefense,
      color: SEGMENT_COLORS.evDefense,
      desc: evDefPending
        ? 'Pending: median on-ice xGA/60 missing from league_context.'
        : `(team off-ice xGA/60 − player on-ice xGA/60) × EV-hours × 1/5 (skater share)`,
      pending: evDefPending,
      sourceLabel: 'league_context.medianOnIceXGA60',
    },
    {
      key: 'powerPlay',
      label: 'Power play',
      value: c.powerPlay,
      color: SEGMENT_COLORS.faceoffs,
      desc: 'PP xGF contribution above what a league-average PP skater would produce in the same PP minutes. Share-weighted by actual on-ice skater count during each PP window.',
      pending: c.powerPlay === 0 && (!result.gamesPlayed || result.gamesPlayed === 0),
      sourceLabel: 'rapm artifact.ppXGF − leaguePpXgfPerMin × ppMinutes',
    },
    {
      key: 'penaltyKill',
      label: 'Penalty kill',
      value: c.penaltyKill,
      color: SEGMENT_COLORS.evDefense,
      desc: 'PK defensive value — expected opposing xG at league PK rate minus opposing xG actually allowed while this player defended. Positive = team gave up less than average PK while this skater was on.',
      pending: c.penaltyKill === 0 && (!result.gamesPlayed || result.gamesPlayed === 0),
      sourceLabel: 'rapm artifact.pkXGA − leaguePkXgaPerMin × pkMinutes (sign-flipped)',
    },
    {
      key: 'faceoffs',
      label: 'Faceoffs',
      value: c.faceoffs,
      color: SEGMENT_COLORS.faceoffs,
      desc: faceoffPending
        ? 'Pending: faceoffValuePerWin missing from league_context.'
        : `(wins − losses) × ${s.faceoffValuePerWin!.toFixed(4)} goals per net-win`,
      pending: faceoffPending,
      sourceLabel: 'league_context.faceoffValuePerWin',
    },
    {
      key: 'turnovers',
      label: 'Turnovers',
      value: c.turnovers,
      color: SEGMENT_COLORS.turnovers,
      desc: turnoverPending
        ? 'Pending: takeaway/giveaway goal values missing from league_context.'
        : `takeaways × ${s.takeawayGoalValue!.toFixed(4)} − giveaways × ${s.giveawayGoalValue!.toFixed(4)} goals`,
      pending: turnoverPending,
      sourceLabel: 'league_context.takeaway/giveawayGoalValue',
    },
    // Hits + blocks excluded from the WAR decomposition — published
    // research (Evolving-Hockey, Hockey Graphs) finds raw hits correlate
    // negatively with goal differential after controlling for possession,
    // and blocks correlate with defensive-zone deployment not quality.
    // The component stayed at 0 in warService; dropping it from the
    // visual too since showing a 0-bar misleads readers into thinking
    // the metric matters.
    {
      key: 'penalties',
      label: 'Discipline',
      value: c.penalties,
      color: SEGMENT_COLORS.penalties,
      desc: `(drawn − taken) × ${s.penaltyValue.toFixed(3)} goals per penalty (this season's PP xG/min × 2)`,
      pending: false,
      sourceLabel: 'league_context.ppXGPerMinute × 2',
    },
    {
      key: 'replacement',
      label: 'vs replacement',
      value: c.replacementAdjust,
      color: SEGMENT_COLORS.replacement,
      desc: `Replacement = 10th-%ile ${result.position} at ${s.replacementGARPerGame.toFixed(3)} GAR/game this season`,
      pending: false,
      sourceLabel: `league_context.skaters.${result.position}.replacementGARPerGame`,
    },
  ];
  // Finishing and Playmaking are individual-skill residuals that also
  // flow into RAPM's EV Offense coefficient (a player's on-ice xGF
  // includes their own shots and their line-mates' shots they set up).
  // Crediting them as separate WAR bars would double-count. The values
  // stay in WARComponents (individual stats), but the breakdown shows
  // only RAPM-derived components + discipline/faceoffs/turnovers + ST +
  // replacement — which is the set that genuinely sums to WAR.
  const segments: Segment[] = rawSegments.filter(
    seg => seg.key !== 'finishing' && seg.key !== 'playmaking',
  );

  // Convert every component to wins (component_goals / marginal goals
  // per win). The chart is titled "Wins Above Replacement"; the bars
  // should add to the WAR shown in the headline, not to a separate
  // GAR figure. Goal-units are still surfaced in tooltips and in the
  // source footer so a reader can audit either way.
  const gpw = Math.max(0.001, s.marginalGoalsPerWin);
  const segValuesWin = segments.map(seg => seg.value / gpw);

  const maxAbs = Math.max(
    0.05,
    ...segValuesWin.map(v => Math.abs(v)),
    Math.abs(result.WAR),
  );

  const pad = compact
    ? { top: 14, right: 36, bottom: 18, left: 130 }
    : { top: 24, right: 44, bottom: 34, left: 150 };
  const plotW = width - pad.left - pad.right;
  const zeroX = pad.left + plotW / 2;
  const pxPerWin = plotW / 2 / maxAbs;
  const rowHeight = compact ? 18 : 28;
  const rowGap = compact ? 2 : 5;
  // `54` in the non-compact layout reserved space for the "Total WAR"
  // row + x-axis label. Compact mode drops the x-axis label row, so
  // the extra only covers the total-WAR row.
  const extraRows = compact ? 28 : 54;
  const height = pad.top + segments.length * (rowHeight + rowGap) + extraRows + pad.bottom;

  const warClass = result.WAR_per_82 > 1 ? 'pos' : result.WAR_per_82 < 0 ? 'neg' : 'neutral';

  // Pace multiplier — bars are cumulative across games played; this
  // converts any segment to its 82-game pace so a viewer can mentally
  // reconcile a partial-season number against a full-season expectation.
  const paceMult = result.gamesPlayed > 0 ? 82 / result.gamesPlayed : 0;

  return (
    <div className="war-break">
      {title && <h3 className="war-title">{title}</h3>}

      <p className="war-explainer">
        <strong>How to read this:</strong> bars are <em>cumulative wins</em> across the
        {' '}{result.gamesPlayed} games this player has played, and they sum to the
        {' '}<strong>{result.WAR.toFixed(2)} WAR</strong> shown to the left. Multiply any bar by
        {' '}<strong>{paceMult.toFixed(2)}× </strong>
        (i.e. 82 ÷ {result.gamesPlayed}) to get its 82-game pace.
        Each component is its goal-units value ÷ {gpw.toFixed(2)} goals-per-win.
      </p>

      <div className="war-headline">
        <div className={`war-number ${warClass}`}>
          <span className="war-value">{result.WAR.toFixed(2)}</span>
          <span className="war-unit">WAR · cumulative</span>
        </div>
        <div className="war-meta">
          <div>
            <span className="war-label">82-game pace</span>
            <span className="war-pace">{result.WAR_per_82.toFixed(2)}</span>
          </div>
          <div>
            <span className="war-label">Percentile ({result.position})</span>
            <span className={`war-pct ${warClass}`}>
              {result.percentile.toFixed(0)} · {result.percentileLabel}
            </span>
          </div>
          <div>
            <span className="war-label">Games</span>
            <span>{result.gamesPlayed}</span>
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
          y1={pad.top} y2={pad.top + segments.length * (rowHeight + rowGap) + 54}
          stroke="rgba(148,163,184,0.5)" strokeDasharray="3 3" />
        <text x={zeroX} y={pad.top - 8} textAnchor="middle" fontSize={10} fill="#94a3b8">0</text>

        <text x={pad.left + 8} y={pad.top - 8} textAnchor="start" fontSize={10} fill="#f87171">← costs wins</text>
        <text x={pad.left + plotW - 8} y={pad.top - 8} textAnchor="end" fontSize={10} fill="#34d399">earns wins →</text>

        {segments.map((seg, i) => {
          const wins = segValuesWin[i];
          const y = pad.top + 14 + i * (rowHeight + rowGap);
          const absV = Math.abs(wins);
          const w = absV * pxPerWin;
          const barX = wins >= 0 ? zeroX : zeroX - w;
          const dim = seg.pending || wins === 0;
          const opacity = seg.pending ? 0.25 : (wins === 0 ? 0.35 : 0.85);
          return (
            <g key={seg.key}>
              <text x={pad.left - 10} y={y + rowHeight / 2 + (compact ? 3 : 4)}
                textAnchor="end" fontSize={compact ? 10 : 12}
                fill={dim ? '#64748b' : '#cbd5f5'}>
                {seg.label}
              </text>
              <rect x={barX} y={y} width={Math.max(w, 1)} height={rowHeight}
                fill={seg.color} opacity={opacity} rx={3}>
                <title>
                  {`${seg.label}
Cumulative: ${fmt(wins)} wins (${fmt(seg.value)} goals ÷ ${gpw.toFixed(2)} goals/win)
82-game pace: ${fmt(wins * paceMult)} wins (${result.gamesPlayed} GP × ${paceMult.toFixed(2)}× pace)
${seg.desc}
source: ${seg.sourceLabel}`}
                </title>
              </rect>
              {seg.pending ? (
                <g>
                  <rect x={barX + 4} y={y + rowHeight / 2 - 7}
                    width={78} height={14} rx={7}
                    fill="rgba(71, 85, 105, 0.6)"
                    stroke="rgba(148, 163, 184, 0.4)" />
                  <text x={barX + 43} y={y + rowHeight / 2 + 3}
                    textAnchor="middle" fontSize={9}
                    fill="#e2e8f0" fontWeight={600}
                    data-pending="true">
                    data pending
                  </text>
                </g>
              ) : (() => {
                // Decide whether the numeric label sits OUTSIDE the bar
                // (short bars) or INSIDE (long bars whose outside-placement
                // would collide with the row's category label on the left,
                // or run off the plot on the right). ~40px is enough room
                // for "-12.34" at fontSize 12.
                const valueTextWidth = 40;
                const outsideX = wins >= 0 ? barX + w + 6 : barX - 6;
                const collidesLeft = wins < 0 && (outsideX - valueTextWidth) < pad.left + 4;
                const collidesRight = wins > 0 && (outsideX + valueTextWidth) > pad.left + plotW;
                const inside = collidesLeft || collidesRight;
                const insideX = wins >= 0 ? barX + w - 6 : barX + 6;
                return (
                  <text x={inside ? insideX : outsideX}
                    y={y + rowHeight / 2 + (compact ? 3 : 4)}
                    textAnchor={inside ? (wins >= 0 ? 'end' : 'start') : (wins >= 0 ? 'start' : 'end')}
                    fontSize={compact ? 10 : 12}
                    fill={inside ? '#0f172a' : (wins > 0 ? '#34d399' : wins < 0 ? '#f87171' : '#64748b')}
                    fontWeight={600}>
                    {fmt(wins)}
                  </text>
                );
              })()}
            </g>
          );
        })}

        {(() => {
          const y = pad.top + 14 + segments.length * (rowHeight + rowGap) + 10;
          const totalW = Math.abs(result.WAR) * pxPerWin;
          const totalX = result.WAR >= 0 ? zeroX : zeroX - totalW;
          return (
            <g>
              <line x1={pad.left - 20} x2={pad.left + plotW}
                y1={y - 4} y2={y - 4}
                stroke="rgba(148, 163, 184, 0.3)" />
              <text x={pad.left - 10} y={y + rowHeight / 2 + (compact ? 3 : 4)}
                textAnchor="end" fontSize={compact ? 11 : 13} fill="#f3f4f6" fontWeight={700}>Total WAR</text>
              <rect x={totalX} y={y} width={Math.max(totalW, 1)} height={rowHeight}
                fill={result.WAR >= 0 ? '#10b981' : '#dc2626'} rx={3}>
                <title>
                  {`Total WAR: ${fmt(result.WAR)} wins (${fmt(c.totalGAR)} GAR ÷ ${gpw.toFixed(2)} goals/win)`}
                </title>
              </rect>
              <text x={result.WAR >= 0 ? totalX + totalW + 6 : totalX - 6}
                y={y + rowHeight / 2 + (compact ? 3 : 4)}
                textAnchor={result.WAR >= 0 ? 'start' : 'end'}
                fontSize={compact ? 11 : 13}
                fill={result.WAR >= 0 ? '#34d399' : '#f87171'}
                fontWeight={700}>
                {fmt(result.WAR)}
              </text>
            </g>
          );
        })()}

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
            Wins above replacement (each bar = component goals ÷ {gpw.toFixed(2)} goals/win)
          </text>
        )}
      </svg>

      {result.notes.length > 0 && (
        <ul className="war-notes">
          {result.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      {/*
        Source line — cites every league-context value that drove a
        component so the viewer can interrogate the numbers. "pending"
        markers make absent inputs auditable rather than silently zero.
      */}
      <p className="war-footer">
        All inputs from this season ({s.season}):
        {' '}marginal goals/win = {s.marginalGoalsPerWin.toFixed(2)} (Pythagorean from standings) ·
        {' '}penalty value = {s.penaltyValue.toFixed(3)} goals (league PP xG/min × 2) ·
        {' '}replacement baseline = {s.replacementGARPerGame.toFixed(3)} GAR/game (10th-%ile {result.position}) ·
        {' '}median ixG/60 ({result.position}) = {s.leagueMedianGARPerGame.toFixed(2)} ·
        {' '}on-ice xGF/60 = {s.medianOnIceXGF60 != null ? s.medianOnIceXGF60.toFixed(2) : 'pending'} ·
        {' '}on-ice xGA/60 = {s.medianOnIceXGA60 != null ? s.medianOnIceXGA60.toFixed(2) : 'pending'} ·
        {' '}faceoff value = {s.faceoffValuePerWin != null ? `${s.faceoffValuePerWin.toFixed(4)} goals/net-win` : 'pending'} ·
        {' '}takeaway value = {s.takeawayGoalValue != null ? `${s.takeawayGoalValue.toFixed(4)} goals` : 'pending'} ·
        {' '}giveaway value = {s.giveawayGoalValue != null ? `${s.giveawayGoalValue.toFixed(4)} goals` : 'pending'} ·
        {' '}hit value = {s.hitGoalValue != null ? `${s.hitGoalValue.toFixed(4)} goals` : 'pending'} ·
        {' '}block value = {s.blockGoalValue != null ? `${s.blockGoalValue.toFixed(4)} goals` : 'pending'}.
        {playerName ? ` · ${playerName}` : ''}
      </p>
    </div>
  );
}
