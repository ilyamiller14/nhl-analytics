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

// v5 palette change: sign-driven diverging color instead of
// per-component hues. Public tools (JFresh, Evolving-Hockey,
// MoneyPuck) all use a single red→neutral→green ramp keyed on sign
// because 8+ component hues fail common colorblindness simulations
// (deuteranopia collapses green/cyan/teal, protanopia collapses
// rose/orange). Component identity is conveyed by row label.
// Replacement baseline stays gray as a deliberate neutral.
const BAR_COLORS = {
  positive: '#34d399',                  // green — contribution above zero
  negative: '#f87171',                  // red   — contribution below zero
  neutral: 'rgba(148, 163, 184, 0.6)',  // slate — replacement baseline
} as const;

function colorForValue(value: number, isReplacement = false): string {
  if (isReplacement) return BAR_COLORS.neutral;
  if (value > 0.01) return BAR_COLORS.positive;
  if (value < -0.01) return BAR_COLORS.negative;
  return BAR_COLORS.neutral;
}

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

  // v5.7 — interpolate data-derived attributions into bar tooltips so
  // readers see the actual derived weights, not hardcoded literature
  // constants. Fallbacks mirror the warService literature defaults so a
  // pre-v5.7 artifact still reads coherently.
  const pmA1 = s.playmakingAttribution;
  const pmA2 = s.secondaryPlaymakingAttribution;
  const foDisc = s.faceoffPossessionDiscount;
  const toShr = s.turnoverShrinkage;

  const rawSegments: Segment[] = [
    {
      key: 'finishing',
      label: 'Finishing (G − xG)',
      value: c.finishing,
      color: '',
      desc: 'Shooting skill above expected on your own shots at EV. Shrunk by season split-half reliability to damp luck. PP finishing excluded — credited in Power Play component.',
      pending: false,
      sourceLabel: 'iG − ixG × (toiEv/toiTotal) × finishingShrinkage',
    },
    {
      key: 'playmaking',
      label: 'Playmaking (A1)',
      value: c.playmaking,
      color: "",
      desc: pmA1 != null
        ? `Primary assists × data-derived attribution fraction. Each A1 is on an actual scored goal; your share of that goal's credit is ${pmA1.toFixed(2)} based on how strongly A1/60 correlates with team on-ice xGF. PP excluded (credited in Power Play).`
        : `Primary assists × data-derived attribution fraction. Each A1 is on an actual scored goal; your share of that goal's credit is derived from how strongly A1/60 correlates with team on-ice xGF (capped [0.3, 0.7]). PP excluded (credited in Power Play).`,
      pending: false,
      sourceLabel: `league_context.playmakingAttribution`,
    },
    {
      key: 'secondaryPlaymaking',
      label: 'Playmaking (A2)',
      value: c.secondaryPlaymaking,
      color: "",
      desc: pmA2 != null
        ? `Secondary playmaking (A2) × data-derived attribution. A2 correlations vs team xGF are weaker than A1's, so your share is ${pmA2.toFixed(2)}. PP excluded (credited in Power Play).`
        : `Secondary playmaking (A2) × data-derived attribution. A2 correlations vs team xGF are weaker than A1's, so your share sits below A1 (capped [0.05, 0.3]). PP excluded (credited in Power Play).`,
      pending: false,
      sourceLabel: `league_context.secondaryPlaymakingAttribution`,
    },
    {
      key: 'evOffense',
      label: 'EV offense (on-ice)',
      value: c.evOffense,
      color: "",
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
      color: "",
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
      color: "",
      desc: 'PP xGF contribution above what a league-average PP skater would produce in the same PP minutes. Share-weighted by actual on-ice skater count during each PP window.',
      pending: c.powerPlay === 0 && (!result.gamesPlayed || result.gamesPlayed === 0),
      sourceLabel: 'rapm artifact.ppXGF − leaguePpXgfPerMin × ppMinutes',
    },
    {
      key: 'penaltyKill',
      label: 'Penalty kill',
      value: c.penaltyKill,
      color: "",
      desc: 'PK defensive value — expected opposing xG at league PK rate minus opposing xG actually allowed while this player defended. Positive = team gave up less than average PK while this skater was on.',
      pending: c.penaltyKill === 0 && (!result.gamesPlayed || result.gamesPlayed === 0),
      sourceLabel: 'rapm artifact.pkXGA − leaguePkXgaPerMin × pkMinutes (sign-flipped)',
    },
    {
      key: 'faceoffs',
      label: 'Faceoffs',
      value: c.faceoffs,
      color: "",
      desc: faceoffPending
        ? 'Pending: faceoffValuePerWin missing from league_context.'
        : `Zone-aware wins × value-per-flip, discounted by ${(foDisc ?? 0.5).toFixed(2)} (${foDisc != null ? 'data-derived' : 'literature fallback'}) because RAPM already captures some of the resulting possession xG.`,
      pending: faceoffPending,
      sourceLabel: 'league_context.ozGoalRatePerWin / dzGoalRateAgainstPerWin × faceoffPossessionDiscount',
    },
    {
      key: 'turnovers',
      label: 'Turnovers',
      value: c.turnovers,
      color: "",
      desc: turnoverPending
        ? 'Pending: takeaway/giveaway goal values missing from league_context.'
        : `Takeaways credited, giveaways penalized, all shrunk by ${(toShr ?? 0.25).toFixed(2)} (${toShr != null ? 'data-derived' : 'literature fallback'}) because RAPM on-ice xGF already captures the xG impact.`,
      pending: turnoverPending,
      sourceLabel: 'league_context.takeaway/giveawayGoalValue × turnoverShrinkage',
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
      color: "",
      desc: `(drawn − taken) × ${s.penaltyValue.toFixed(3)} goals per penalty (this season's PP xG/min × 2)`,
      pending: false,
      sourceLabel: 'league_context.ppXGPerMinute × 2',
    },
    {
      key: 'replacement',
      label: 'vs replacement',
      value: c.replacementAdjust,
      color: "",
      desc: `Replacement = 10th-%ile ${result.position} at ${s.replacementGARPerGame.toFixed(3)} GAR/game this season`,
      pending: false,
      sourceLabel: `league_context.skaters.${result.position}.replacementGARPerGame`,
    },
  ];
  // v5.1: Finishing and Playmaking are BACK in the WAR sum at full
  // weight (matches Evolving-Hockey / Sprigings methodology). Chart
  // shows them as the first two rows so the sum visibly reconciles to
  // the headline WAR.
  const segments: Segment[] = rawSegments;

  // Convert every component to wins (component_goals / marginal goals
  // per win). The chart is titled "Wins Above Replacement"; the bars
  // should add to the WAR shown in the headline, not to a separate
  // GAR figure. Goal-units are still surfaced in tooltips and in the
  // source footer so a reader can audit either way.
  const gpw = Math.max(0.001, s.marginalGoalsPerWin);
  const segValuesWin = segments.map(seg => seg.value / gpw);

  // Pace multiplier — bars are cumulative across games played; this
  // converts any segment to its 82-game pace so a viewer can mentally
  // reconcile a partial-season number against a full-season expectation.
  const paceMult = result.gamesPlayed > 0 ? 82 / result.gamesPlayed : 0;

  // Projection delta = (82-GP pace − cumulative). Rendered as a faded
  // extension on the same bar so a viewer sees at a glance "here's what
  // this player has contributed so far, and here's what extrapolating
  // that pace through a full 82-GP schedule would add." Only shown for
  // <80 GP since full-season veterans have zero delta.
  const SHOW_PROJECTION = result.gamesPlayed > 0 && result.gamesPlayed < 80;
  const segValuesProj = segments.map((_, i) =>
    SHOW_PROJECTION ? segValuesWin[i] * paceMult : 0);

  const maxAbs = Math.max(
    0.05,
    ...segValuesWin.map(v => Math.abs(v)),
    ...(SHOW_PROJECTION ? segValuesProj.map(v => Math.abs(v)) : []),
    Math.abs(result.WAR),
    SHOW_PROJECTION ? Math.abs(result.WAR_per_82) : 0,
  );

  const pad = compact
    ? { top: 14, right: 36, bottom: 18, left: 130 }
    : { top: 24, right: 44, bottom: 34, left: 150 };
  const plotW = width - pad.left - pad.right;
  const zeroX = pad.left + plotW / 2;
  const pxPerWin = plotW / 2 / maxAbs;
  const rowHeight = compact ? 18 : 28;
  const rowGap = compact ? 2 : 5;
  const extraRows = compact ? 28 : 54;
  const height = pad.top + segments.length * (rowHeight + rowGap) + extraRows + pad.bottom;

  const warClass = result.WAR_per_82 > 1 ? 'pos' : result.WAR_per_82 < 0 ? 'neg' : 'neutral';

  return (
    <div className="war-break">
      {title && <h3 className="war-title">{title}</h3>}

      <p className="war-explainer">
        <strong>How to read this:</strong>
        {SHOW_PROJECTION ? (
          <>
            {' '}each bar is cumulative WAR through {result.gamesPlayed} GP
            ({(result.gamesPlayed / 82 * 100).toFixed(0)}% of an 82-GP season).
            The <strong>dashed tick</strong> marks the 82-GP pace projection
            (×{paceMult.toFixed(2)}) — where the bar would end if the current
            rate held through the remaining {82 - result.gamesPlayed} games.
            Numeric label is the cumulative value.
          </>
        ) : (
          <>
            {' '}bars are <em>cumulative wins</em> across all
            {' '}{result.gamesPlayed} games, summing to
            {' '}<strong>{result.WAR.toFixed(2)} WAR</strong>.
          </>
        )}
        {' '}Each component is its goal-units value ÷ {gpw.toFixed(2)} goals-per-win.
        {' '}<strong>Each component credits a distinct source of value:</strong>
        {' '}RAPM captures team-level on-ice xG; Finishing and Playmaking (A1/A2)
        {' '}credit only the above-expected residual on shots you took or set up
        {' '}at EV; Faceoffs and Turnovers are discounted to avoid double-counting
        {' '}with RAPM; PP/PK finishing is credited separately so EV components
        {' '}stay orthogonal.
      </p>

      <div className="war-headline">
        <div className={`war-number ${warClass}`}>
          <span className="war-value">{result.WAR.toFixed(2)}</span>
          {/*
            Label disambiguates cumulative WAR from the 82-GP pace
            number shown on the share card / HeroStat. Earlier copy
            ("WAR · cumulative") was still ambiguous enough that two
            different values both labelled "WAR" confused readers on
            partial-season players (Hughes: 61 GP → 1.64 cumulative
            vs 2.21 per-82). Explicitly stamping the GP count on the
            headline anchors the number to its denominator, and the
            82-GP pace sub-stat below makes the relationship explicit.
          */}
          <span className="war-unit">WAR · {result.gamesPlayed} GP</span>
          <span className="war-pace-sub">82-GP pace: {result.WAR_per_82.toFixed(2)}</span>
        </div>
        <div className="war-meta">
          <div>
            <span className="war-label">82-GP pace</span>
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
          const winsProj = segValuesProj[i];
          const y = pad.top + 14 + i * (rowHeight + rowGap);
          const pendingPill = seg.pending;
          // Single bar per segment. The bright portion = cumulative
          // (what's already happened). The faded tail = extrapolated
          // delta to 82-GP pace (cumulative × paceMult − cumulative).
          // Both grow from zero on the same side of the axis; the
          // projection is drawn AFTER the cumulative so it looks like a
          // natural extension of the same bar.
          const cumAbs = Math.abs(wins);
          const projAbs = Math.abs(winsProj);
          const deltaAbs = Math.max(0, projAbs - cumAbs); // only tail; same sign as wins
          const sign = wins >= 0 ? 1 : (winsProj >= 0 ? 1 : -1);
          const cumW = cumAbs * pxPerWin;
          const deltaW = deltaAbs * pxPerWin;
          const barStartX = sign >= 0 ? zeroX : zeroX - cumW;
          // Delta extends from the END of the cumulative segment,
          // further away from zero.
          const deltaStartX = sign >= 0 ? zeroX + cumW : zeroX - cumW - deltaW;
          const dim = pendingPill || (cumAbs === 0 && deltaAbs === 0);
          return (
            <g key={seg.key}>
              <text x={pad.left - 10} y={y + rowHeight / 2 + (compact ? 3 : 4)}
                textAnchor="end" fontSize={compact ? 10 : 12}
                fill={dim ? '#64748b' : '#cbd5f5'}>
                {seg.label}
              </text>
              {pendingPill ? (
                <g>
                  <rect x={zeroX - 39} y={y + rowHeight / 2 - 7}
                    width={78} height={14} rx={7}
                    fill="rgba(71, 85, 105, 0.6)"
                    stroke="rgba(148, 163, 184, 0.4)" />
                  <text x={zeroX} y={y + rowHeight / 2 + 3}
                    textAnchor="middle" fontSize={9}
                    fill="#e2e8f0" fontWeight={600}
                    data-pending="true">
                    data pending
                  </text>
                </g>
              ) : (
                <>
                  {/* Cumulative bar — sign-driven diverging color. */}
                  <rect x={barStartX} y={y} width={Math.max(cumW, 1)} height={rowHeight}
                    fill={colorForValue(wins, seg.key === 'replacement')}
                    opacity={cumAbs === 0 ? 0.25 : 0.9} rx={2}>
                    <title>
                      {`${seg.label}
Cumulative: ${fmt(wins)} wins · ${result.gamesPlayed} GP
82-GP pace: ${fmt(winsProj)} wins (×${paceMult.toFixed(2)})
${seg.desc}
source: ${seg.sourceLabel}`}
                    </title>
                  </rect>
                  {/* Pace tick — single vertical mark at the projected
                      82-GP endpoint. Cleaner than a faded tail (agent
                      feedback: stacked fill invites readers to sum the
                      two segments). The tick shows projection without
                      claiming it as cumulative evidence. */}
                  {SHOW_PROJECTION && deltaW > 0 && (
                    <g>
                      <line
                        x1={deltaStartX + deltaW}
                        x2={deltaStartX + deltaW}
                        y1={y - 3}
                        y2={y + rowHeight + 3}
                        stroke={colorForValue(winsProj, seg.key === 'replacement')}
                        strokeWidth={2}
                        strokeDasharray="2 2"
                        opacity={0.85}
                      />
                      <title>
                        {`${seg.label} — 82-GP pace marker at ${fmt(winsProj)} wins`}
                      </title>
                    </g>
                  )}
                  {/* Value label — shows cumulative; 82-GP pace in tooltip.
                      Anchoring the visible number to cumulative avoids
                      the "bar says X, label says Y" disagreement the
                      faded-tail variant had. */}
                  {(() => {
                    const valueTextWidth = 44;
                    const outsideX = sign >= 0 ? barStartX + cumW + 6 : barStartX - 6;
                    const collidesLeft = sign < 0 && (outsideX - valueTextWidth) < pad.left + 4;
                    const collidesRight = sign > 0 && (outsideX + valueTextWidth) > pad.left + plotW;
                    const inside = collidesLeft || collidesRight;
                    const insideX = sign >= 0 ? barStartX + cumW - 6 : barStartX + 6;
                    return (
                      <text x={inside ? insideX : outsideX}
                        y={y + rowHeight / 2 + 4}
                        textAnchor={inside ? (sign >= 0 ? 'end' : 'start') : (sign >= 0 ? 'start' : 'end')}
                        fontSize={compact ? 10 : 12}
                        fill={inside ? '#0f172a' : (wins > 0 ? '#34d399' : wins < 0 ? '#f87171' : '#64748b')}
                        fontWeight={600}>
                        {fmt(wins)}
                      </text>
                    );
                  })()}
                </>
              )}
            </g>
          );
        })}

        {(() => {
          const y = pad.top + 14 + segments.length * (rowHeight + rowGap) + 10;
          const cum = result.WAR;
          const proj = result.WAR_per_82;
          const cumAbs = Math.abs(cum);
          const projAbs = Math.abs(proj);
          const deltaAbs = Math.max(0, projAbs - cumAbs);
          const sign = cum >= 0 ? 1 : (proj >= 0 ? 1 : -1);
          const cumW = cumAbs * pxPerWin;
          const deltaW = deltaAbs * pxPerWin;
          const barStartX = sign >= 0 ? zeroX : zeroX - cumW;
          const deltaStartX = sign >= 0 ? zeroX + cumW : zeroX - cumW - deltaW;
          void deltaW; // used in tick marker below
          const posColor = '#10b981';
          const negColor = '#dc2626';
          const mainColor = sign >= 0 ? posColor : negColor;
          return (
            <g>
              <line x1={pad.left - 20} x2={pad.left + plotW}
                y1={y - 4} y2={y - 4}
                stroke="rgba(148, 163, 184, 0.3)" />
              <text x={pad.left - 10} y={y + rowHeight / 2 + (compact ? 3 : 4)}
                textAnchor="end" fontSize={compact ? 11 : 13} fill="#f3f4f6" fontWeight={700}>Total WAR</text>
              <rect x={barStartX} y={y} width={Math.max(cumW, 1)} height={rowHeight}
                fill={mainColor} rx={2}>
                <title>{`Total WAR — cumulative: ${fmt(cum)} wins · 82-GP pace: ${fmt(proj)} wins`}</title>
              </rect>
              {SHOW_PROJECTION && deltaW > 0 && (
                <g>
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
                  <title>{`82-GP pace marker at ${fmt(proj)} WAR`}</title>
                </g>
              )}
              <text x={sign >= 0 ? barStartX + cumW + 6 : barStartX - 6}
                y={y + rowHeight / 2 + (compact ? 3 : 4)}
                textAnchor={sign >= 0 ? 'start' : 'end'}
                fontSize={compact ? 11 : 13}
                fill={mainColor === posColor ? '#34d399' : '#f87171'}
                fontWeight={700}>
                {fmt(cum)}
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
