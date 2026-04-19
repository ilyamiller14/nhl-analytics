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

export default function WARBreakdown({ result, title, playerName, width = 720 }: Props) {
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
  const microPending = s.hitGoalValue == null || s.blockGoalValue == null;

  const segments: Segment[] = [
    {
      key: 'finishing',
      label: 'Finishing (G − xG)',
      value: c.finishing,
      color: SEGMENT_COLORS.finishing,
      desc: 'Individual goals minus expected from their shots',
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
    {
      key: 'micro',
      label: 'Micro (hits + blocks)',
      value: c.micro,
      color: SEGMENT_COLORS.micro,
      desc: microPending
        ? 'Pending: hit/block goal values missing from league_context.'
        : `hits × ${s.hitGoalValue!.toFixed(4)} + blocks × ${s.blockGoalValue!.toFixed(4)} goals`,
      pending: microPending,
      sourceLabel: 'league_context.hit/blockGoalValue',
    },
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

  const maxAbs = Math.max(
    0.5,
    ...segments.map(seg => Math.abs(seg.value)),
    Math.abs(c.totalGAR),
  );

  const pad = { top: 24, right: 44, bottom: 34, left: 150 };
  const plotW = width - pad.left - pad.right;
  const zeroX = pad.left + plotW / 2;
  const pxPerGoal = plotW / 2 / maxAbs;
  const rowHeight = 28;
  const rowGap = 5;
  const height = pad.top + segments.length * (rowHeight + rowGap) + 54 + pad.bottom;

  const warClass = result.WAR_per_82 > 1 ? 'pos' : result.WAR_per_82 < 0 ? 'neg' : 'neutral';

  return (
    <div className="war-break">
      {title && <h3 className="war-title">{title}</h3>}

      <div className="war-headline">
        <div className={`war-number ${warClass}`}>
          <span className="war-value">{result.WAR.toFixed(2)}</span>
          <span className="war-unit">WAR</span>
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
          const y = pad.top + 14 + i * (rowHeight + rowGap);
          const absV = Math.abs(seg.value);
          const w = absV * pxPerGoal;
          const barX = seg.value >= 0 ? zeroX : zeroX - w;
          const dim = seg.pending || seg.value === 0;
          const opacity = seg.pending ? 0.25 : (seg.value === 0 ? 0.35 : 0.85);
          return (
            <g key={seg.key}>
              <text x={pad.left - 10} y={y + rowHeight / 2 + 4}
                textAnchor="end" fontSize={12}
                fill={dim ? '#64748b' : '#cbd5f5'}>
                {seg.label}
              </text>
              <rect x={barX} y={y} width={Math.max(w, 1)} height={rowHeight}
                fill={seg.color} opacity={opacity} rx={3}>
                <title>
                  {`${seg.label}: ${fmt(seg.value)} goals\n${seg.desc}\nsource: ${seg.sourceLabel}`}
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
              ) : (
                <text x={seg.value >= 0 ? barX + w + 6 : barX - 6}
                  y={y + rowHeight / 2 + 4}
                  textAnchor={seg.value >= 0 ? 'start' : 'end'}
                  fontSize={12}
                  fill={seg.value > 0 ? '#34d399' : seg.value < 0 ? '#f87171' : '#64748b'}
                  fontWeight={600}>
                  {fmt(seg.value)}
                </text>
              )}
            </g>
          );
        })}

        {(() => {
          const y = pad.top + 14 + segments.length * (rowHeight + rowGap) + 10;
          const totalW = Math.abs(c.totalGAR) * pxPerGoal;
          const totalX = c.totalGAR >= 0 ? zeroX : zeroX - totalW;
          return (
            <g>
              <line x1={pad.left - 20} x2={pad.left + plotW}
                y1={y - 4} y2={y - 4}
                stroke="rgba(148, 163, 184, 0.3)" />
              <text x={pad.left - 10} y={y + rowHeight / 2 + 4}
                textAnchor="end" fontSize={13} fill="#f3f4f6" fontWeight={700}>Total GAR</text>
              <rect x={totalX} y={y} width={Math.max(totalW, 1)} height={rowHeight}
                fill={c.totalGAR >= 0 ? '#10b981' : '#dc2626'} rx={3} />
              <text x={c.totalGAR >= 0 ? totalX + totalW + 6 : totalX - 6}
                y={y + rowHeight / 2 + 4}
                textAnchor={c.totalGAR >= 0 ? 'start' : 'end'}
                fontSize={13}
                fill={c.totalGAR >= 0 ? '#34d399' : '#f87171'}
                fontWeight={700}>
                {fmt(c.totalGAR)}
              </text>
            </g>
          );
        })()}

        {[-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs].map((t, i) => {
          const x = zeroX + t * pxPerGoal;
          const yAxis = height - pad.bottom + 4;
          return (
            <g key={`tick-${i}`}>
              <line x1={x} x2={x} y1={yAxis - 6} y2={yAxis} stroke="rgba(148,163,184,0.4)" />
              <text x={x} y={yAxis + 12} textAnchor="middle" fontSize={10} fill="#94a3b8">
                {t >= 0 ? '+' : ''}{t.toFixed(1)}
              </text>
            </g>
          );
        })}
        <text x={pad.left + plotW / 2} y={height - 4} textAnchor="middle"
          fontSize={10} fill="#94a3b8">Goals above replacement (GAR)</text>
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
