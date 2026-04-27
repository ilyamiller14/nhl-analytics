/**
 * WAR History Strip — time-series-per-metric visualization.
 *
 * Each metric (WAR/82, EV offense, EV defense, PP, PK, etc.) gets its
 * own row with a 3-point mini line chart across the last 1-3 seasons.
 * Replaces the previous row-per-season layout so a viewer can see how
 * each metric trended over time, not just the headline WAR.
 *
 * Visual language:
 *   - Sign-driven dot colors (green positive, red negative, gray neutral)
 *   - Neutral connecting line — slope is implied by dot positions
 *   - Per-row autoscaled Y-axis (each metric stands on its own range)
 *   - Component values normalized to per-82 so partial-season points
 *     compare honestly against full 82-GP prior seasons
 *
 * Props:
 *   - playerId       — required when `history` is not pre-loaded
 *   - position       — 'F'/'D'/'G' (drives metric set selection)
 *   - history?       — optional pre-loaded WARHistoryEntry[]
 *   - currentSeasonResult? — pre-computed current-season WAR result from
 *                             the parent. When supplied, the strip uses
 *                             it for the current-season point instead of
 *                             the raw worker context produced by
 *                             warHistoryService. Eliminates the historical
 *                             mismatch between this strip and the
 *                             share card's hero / WAR breakdown.
 *   - compact?       — true: share-card slot (5 metrics for skater,
 *                       4 for goalie); false: deep tab (all metrics)
 *
 * Hard-rule compliance:
 *   - NO mock data — missing seasons render as faded "no data" markers,
 *     never fabricated zeros
 *   - NO hardcoded league averages — comparisons come from each season's
 *     own LeagueContext via warHistoryService
 *   - Season format: 8-digit internally, displayed as '2024-25'
 */

import { useEffect, useState } from 'react';
import type { WARHistoryEntry } from '../../services/warHistoryService';
import { loadWARHistory } from '../../services/warHistoryService';
import type {
  WARResult,
  GoalieWARResult,
  WARComponents,
  GoalieWARComponents,
} from '../../services/warService';
import './WARHistoryStrip.css';

interface Props {
  playerId: number;
  position: 'F' | 'D' | 'G';
  history?: WARHistoryEntry[];
  /** Pre-computed current-season WAR result. When provided, the strip
   *  overrides the loaded history's most-recent entry with this result —
   *  guaranteeing the current-season point matches the share card's
   *  hero stat and WAR breakdown chart (which use the same enriched
   *  context). Prior seasons keep their raw-worker-context values. */
  currentSeasonResult?: WARResult | GoalieWARResult | null;
  compact?: boolean;
  seasons?: number;
  title?: string;
}

function formatSeasonLabel(season: string): string {
  if (!season || season.length !== 8) return season;
  return `${season.slice(0, 4)}-${season.slice(6, 8)}`;
}

const COLOR_POS = '#34d399';
const COLOR_NEG = '#f87171';
const COLOR_NEUTRAL = 'rgba(148, 163, 184, 0.6)';
const COLOR_LINE = 'rgba(148, 163, 184, 0.45)';
const COLOR_NODATA = 'rgba(148, 163, 184, 0.35)';

function colorForValue(v: number): string {
  if (v > 0.01) return COLOR_POS;
  if (v < -0.01) return COLOR_NEG;
  return COLOR_NEUTRAL;
}

function fmt(n: number, d = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

// Normalize a cumulative goal-units component to per-82 so partial-season
// points compare honestly against full-season prior years. WAR/82 is
// already per-82 — those rows skip this transform.
function per82(value: number, gamesPlayed: number): number {
  if (gamesPlayed <= 0) return 0;
  return (value * 82) / gamesPlayed;
}

// Metric definitions: how to extract a value from a WARHistoryEntry. The
// `compactOnly` flag marks rows that show in the deep tab but not in the
// share-card compact slot (vertical budget).
interface MetricDef {
  key: string;
  label: string;
  unit: string; // shown next to label, e.g. "WAR/82" or "g/82"
  /** Returns the per-row value for an entry, or null when the metric
   *  doesn't apply to this entry's position (e.g. faceoffs for non-C). */
  extract: (entry: WARHistoryEntry) => number | null;
  /** When true, hidden in compact mode. */
  fullModeOnly?: boolean;
}

// Skater metrics — first 5 are visible in compact (share card), rest
// are surfaced in the deep tab. Order top→bottom = importance.
const SKATER_METRICS: MetricDef[] = [
  {
    key: 'war82',
    label: 'WAR/82',
    unit: 'wins',
    extract: e => (typeof e.WAR_per_82 === 'number' ? e.WAR_per_82 : null),
  },
  {
    key: 'evOff',
    label: 'EV offense',
    unit: 'g/82',
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.evOffense), e.gamesPlayed);
    },
  },
  {
    key: 'evDef',
    label: 'EV defense',
    unit: 'g/82',
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.evDefense), e.gamesPlayed);
    },
  },
  {
    key: 'pp',
    label: 'Power play',
    unit: 'g/82',
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.powerPlay), e.gamesPlayed);
    },
  },
  {
    key: 'pk',
    label: 'Penalty kill',
    unit: 'g/82',
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.penaltyKill), e.gamesPlayed);
    },
  },
  // Full-mode-only rows below
  {
    key: 'finishing',
    label: 'Finishing',
    unit: 'g/82',
    fullModeOnly: true,
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.finishing), e.gamesPlayed);
    },
  },
  {
    key: 'playmaking',
    label: 'Playmaking (A1)',
    unit: 'g/82',
    fullModeOnly: true,
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.playmaking), e.gamesPlayed);
    },
  },
  {
    key: 'secPlaymaking',
    label: 'Playmaking (A2)',
    unit: 'g/82',
    fullModeOnly: true,
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.secondaryPlaymaking), e.gamesPlayed);
    },
  },
  {
    key: 'faceoffs',
    label: 'Faceoffs',
    unit: 'g/82',
    fullModeOnly: true,
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      const v = num(c.faceoffs);
      // Hide row entirely (return null) if the player took no faceoffs
      // in any season. Centers will have non-zero; wings/D won't.
      return v === 0 ? null : per82(v, e.gamesPlayed);
    },
  },
  {
    key: 'turnovers',
    label: 'Turnovers',
    unit: 'g/82',
    fullModeOnly: true,
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.turnovers), e.gamesPlayed);
    },
  },
  {
    key: 'penalties',
    label: 'Discipline',
    unit: 'g/82',
    fullModeOnly: true,
    extract: e => {
      const c = e.components as Partial<WARComponents>;
      return per82(num(c.penalties), e.gamesPlayed);
    },
  },
];

const GOALIE_METRICS: MetricDef[] = [
  {
    key: 'war82',
    label: 'WAR/82',
    unit: 'wins',
    extract: e => (typeof e.WAR_per_82 === 'number' ? e.WAR_per_82 : null),
  },
  {
    key: 'gsax',
    label: 'GSAx',
    unit: 'goals',
    // Cumulative GSAx — kept as raw goals (not per-82) since a goalie
    // who plays 60 GP at +20 GSAx is a different headline story than
    // one who plays 20 GP at +7 GSAx. Both deserve their own context.
    extract: e => (typeof e.GSAx === 'number' ? e.GSAx : null),
  },
  {
    key: 'savePerf',
    label: 'Save (g/82)',
    unit: 'g/82',
    extract: e => {
      const c = e.components as Partial<GoalieWARComponents>;
      return per82(num(c.savePerformance), e.gamesPlayed);
    },
  },
  {
    key: 'replAdj',
    label: 'vs Replacement',
    unit: 'g/82',
    fullModeOnly: true,
    extract: e => {
      const c = e.components as Partial<GoalieWARComponents>;
      return per82(num(c.replacementAdjust), e.gamesPlayed);
    },
  },
];

// Build a per-row series across the 3 seasons. Returns one entry per
// configured season slot — even slots without data are kept so the
// shared time axis stays aligned across rows.
interface SeriesPoint {
  season: string;
  value: number | null; // null = no data for this season
  gamesPlayed: number | null;
}

function buildSeries(metric: MetricDef, ordered: WARHistoryEntry[]): SeriesPoint[] {
  return ordered.map(e => ({
    season: e.season,
    value: metric.extract(e),
    gamesPlayed: e.gamesPlayed,
  }));
}

// Override the most-recent entry's WAR + components with the parent's
// pre-computed (enriched-context) result. This is the bug fix for the
// data mismatch between the strip and the hero stat / WAR breakdown.
function overrideCurrentSeasonEntry(
  ordered: WARHistoryEntry[],
  currentSeasonResult: WARResult | GoalieWARResult | null | undefined,
): WARHistoryEntry[] {
  if (!currentSeasonResult || ordered.length === 0) return ordered;
  // The "current season" is the LAST entry in `ordered` (oldest → newest
  // sort). We override it in place so the rest of the strip behaves
  // identically.
  const lastIdx = ordered.length - 1;
  const last = ordered[lastIdx];
  // Sanity guard: only override when the GP matches (proves the parent
  // result corresponds to the same player+season). Tolerant of off-by-one
  // GP differences from caching races.
  if (Math.abs(last.gamesPlayed - currentSeasonResult.gamesPlayed) > 2) {
    return ordered;
  }
  const overridden: WARHistoryEntry = {
    ...last,
    WAR: currentSeasonResult.WAR,
    WAR_per_82: currentSeasonResult.WAR_per_82,
    components: currentSeasonResult.components,
    gamesPlayed: currentSeasonResult.gamesPlayed,
  };
  // Goalie-only fields
  if ('GSAx' in currentSeasonResult) {
    overridden.GSAx = currentSeasonResult.GSAx;
    overridden.shotsFaced = currentSeasonResult.shotsFaced;
    overridden.goalsAllowed = currentSeasonResult.goalsAllowed;
  }
  const out = ordered.slice();
  out[lastIdx] = overridden;
  return out;
}

// SVG sparkline geometry constants. ViewBox tuned so the per-dot value
// labels (fontSize 9, ~14px tall in viewBox units) fit above/below the
// dots without clipping. Plot area = full viewBox minus padding;
// labels float in the padding zone above/below.
const VB_W = 140;
const VB_H = 36;
const PAD_X = 16;
const PAD_Y = 12;

function MetricRow({
  metric,
  series,
  compact,
}: {
  metric: MetricDef;
  series: SeriesPoint[];
  compact: boolean;
}) {
  // Per-row autoscale — each metric's Y range comes from its own values
  // so PP (typically ±2) and WAR/82 (±6) both render visibly.
  const finiteValues = series
    .filter((p): p is SeriesPoint & { value: number } => p.value != null)
    .map(p => p.value);
  if (finiteValues.length === 0) {
    // No data at all in any season — render the row with empty markers
    // rather than hiding it (preserves vertical alignment across rows).
    return (
      <div className="wh-metric-row" role="listitem">
        <div className="wh-metric-label">
          <span className="wh-metric-name">{metric.label}</span>
          <span className="wh-metric-unit">{metric.unit}</span>
        </div>
        <div className="wh-metric-spark">
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="wh-spark-svg">
            <line x1={PAD_X} x2={VB_W - PAD_X} y1={VB_H / 2} y2={VB_H / 2} stroke={COLOR_LINE} strokeDasharray="2 2" />
          </svg>
        </div>
        <div className="wh-metric-current">—</div>
      </div>
    );
  }
  const maxAbs = Math.max(0.05, ...finiteValues.map(v => Math.abs(v)));
  // Symmetric around 0 so positive/negative values are visually
  // comparable. We add a small margin so dots near max don't kiss the
  // edge.
  const yMin = -maxAbs * 1.1;
  const yMax = maxAbs * 1.1;
  const plotW = VB_W - 2 * PAD_X;
  const plotH = VB_H - 2 * PAD_Y;
  const xFor = (i: number, n: number) =>
    n <= 1 ? PAD_X + plotW / 2 : PAD_X + (i / (n - 1)) * plotW;
  const yFor = (v: number) =>
    PAD_Y + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const zeroY = yFor(0);

  // Most-recent value (newest season — last in series). May be null if
  // current season has no data, in which case fall back to the last
  // non-null point and prefix the label with "(prev)".
  const latest = series[series.length - 1];
  let displayValue: number | null = latest.value;
  let displayPrefix = '';
  if (displayValue == null) {
    for (let i = series.length - 2; i >= 0; i--) {
      if (series[i].value != null) {
        displayValue = series[i].value!;
        displayPrefix = `${formatSeasonLabel(series[i].season).slice(0, 5)} `;
        break;
      }
    }
  }

  // Build the connecting line as a polyline that skips null gaps. We
  // render TWO polylines: one solid (between consecutive non-null points)
  // and one dashed (across gaps). Simpler: just render solid segments
  // between consecutive non-null pairs.
  const segments: Array<[number, number, number, number, boolean]> = [];
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i];
    const b = series[i + 1];
    if (a.value == null || b.value == null) {
      // Gap — skip drawing a segment. The dots themselves still render.
      continue;
    }
    segments.push([
      xFor(i, series.length),
      yFor(a.value),
      xFor(i + 1, series.length),
      yFor(b.value),
      false,
    ]);
  }

  const tooltip = series
    .map(p => {
      const label = formatSeasonLabel(p.season);
      if (p.value == null) return `${label}: —`;
      return `${label}: ${fmt(p.value, 2)}`;
    })
    .join(' · ');

  return (
    <div className="wh-metric-row" role="listitem" title={tooltip}>
      <div className="wh-metric-label">
        <span className="wh-metric-name">{metric.label}</span>
        {!compact && <span className="wh-metric-unit">{metric.unit}</span>}
      </div>
      <div className="wh-metric-spark">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="wh-spark-svg">
          {/* Zero baseline */}
          <line
            x1={PAD_X}
            x2={VB_W - PAD_X}
            y1={zeroY}
            y2={zeroY}
            stroke={COLOR_LINE}
            strokeDasharray="2 2"
          />
          {/* Connecting segments between consecutive non-null points */}
          {segments.map(([x1, y1, x2, y2], i) => (
            <line
              key={`seg-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={COLOR_LINE}
              strokeWidth={1.5}
            />
          ))}
          {/* Dots + per-dot value labels — sign-colored when present,
              faded open circle + dash when absent. Labels float above
              the dot when value >= 0 and below when negative so they
              never cross the zero baseline ambiguously. The most-recent
              dot's label leans LEFT of the dot so it doesn't get cut
              off by the SVG right edge. */}
          {series.map((p, i) => {
            const cx = xFor(i, series.length);
            const isLast = i === series.length - 1;
            const isFirst = i === 0;
            // Anchor / x-offset so labels don't clip:
            //   first dot: anchor left, slight right offset
            //   last dot: anchor right, slight left offset
            //   middle: anchor middle
            const labelAnchor: 'start' | 'middle' | 'end' = isFirst
              ? 'start'
              : isLast
              ? 'end'
              : 'middle';
            const labelDx = isFirst ? -2 : isLast ? 2 : 0;
            if (p.value == null) {
              return (
                <g key={p.season}>
                  <circle
                    cx={cx}
                    cy={zeroY}
                    r={2.2}
                    fill="none"
                    stroke={COLOR_NODATA}
                    strokeWidth={1}
                  />
                  <text
                    x={cx - labelDx}
                    y={zeroY - 5}
                    textAnchor={labelAnchor}
                    fontSize={9}
                    fill="rgba(148,163,184,0.55)"
                  >
                    —
                  </text>
                </g>
              );
            }
            const dy = yFor(p.value);
            // Label above when value >= 0, below when < 0 (away from
            // zero line). With 4px offset for breathing room.
            const labelY =
              p.value >= 0
                ? Math.max(VB_H * 0.18, dy - 4)
                : Math.min(VB_H - 1, dy + 9);
            return (
              <g key={p.season}>
                <circle
                  cx={cx}
                  cy={dy}
                  r={3.2}
                  fill={colorForValue(p.value)}
                />
                <text
                  x={cx - labelDx}
                  y={labelY}
                  textAnchor={labelAnchor}
                  fontSize={9}
                  fontWeight={700}
                  fill={colorForValue(p.value)}
                >
                  {fmt(p.value, 1)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div
        className="wh-metric-current"
        style={{ color: displayValue != null ? colorForValue(displayValue) : 'rgba(255,255,255,0.45)' }}
      >
        {displayValue != null ? `${displayPrefix}${fmt(displayValue, 2)}` : '—'}
      </div>
    </div>
  );
}

export default function WARHistoryStrip({
  playerId,
  position,
  history: preloaded,
  currentSeasonResult,
  compact = false,
  seasons = 3,
  title,
}: Props) {
  const [history, setHistory] = useState<WARHistoryEntry[] | null>(
    preloaded ?? null,
  );
  const [loading, setLoading] = useState<boolean>(!preloaded);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preloaded) {
      setHistory(preloaded);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadWARHistory(playerId, { seasons })
      .then(rows => {
        if (cancelled) return;
        setHistory(rows);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('WARHistoryStrip: load failed', err);
        setError('Could not load history.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId, seasons, preloaded]);

  if (loading) {
    return (
      <div className={`war-history-strip${compact ? ' compact' : ''}`}>
        {title && <div className="wh-title">{title}</div>}
        <div className="wh-empty">Loading history…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`war-history-strip${compact ? ' compact' : ''}`}>
        {title && <div className="wh-title">{title}</div>}
        <div className="wh-empty">{error}</div>
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className={`war-history-strip${compact ? ' compact' : ''}`}>
        {title && <div className="wh-title">{title}</div>}
        <div className="wh-empty">No prior-season data.</div>
      </div>
    );
  }

  // Order display oldest → newest so the time axis reads left → right.
  // Service returns newest-first.
  let ordered = [...history].reverse();
  // Apply the parent's enriched-context current-season result so the
  // newest point matches the share card's hero stat / WAR breakdown.
  ordered = overrideCurrentSeasonEntry(ordered, currentSeasonResult ?? null);

  // Pick the metric set based on position. Per-entry detection (vs the
  // prop) protects against a malformed artifact where a goalie gets a
  // skater-shaped components object — but the strip's position prop
  // selects the row set for the player as a whole.
  const allMetrics = position === 'G' ? GOALIE_METRICS : SKATER_METRICS;
  const visibleMetrics = compact
    ? allMetrics.filter(m => !m.fullModeOnly)
    : allMetrics;

  // Drop metrics that produce all-null/zero across every season (e.g.
  // faceoffs for a non-C). The "all zero" check avoids hiding a row
  // that genuinely had a 0 value in one season — only kill rows whose
  // every season is null OR exactly 0 (the metric doesn't apply).
  const renderableMetrics = visibleMetrics.filter(m => {
    return ordered.some(e => {
      const v = m.extract(e);
      return v != null && v !== 0;
    });
  });

  // Season labels for the shared X-axis
  const seasonLabels = ordered.map(e => formatSeasonLabel(e.season));

  return (
    <div className={`war-history-strip${compact ? ' compact' : ''}`}>
      {title && <div className="wh-title">{title}</div>}

      {/* Shared X-axis — season labels above the metric rows. Aligned
          so each label sits over its corresponding sparkline column. */}
      <div className="wh-axis" aria-hidden="true">
        <div className="wh-axis-spacer-left" />
        <div className="wh-axis-track">
          {seasonLabels.map((label, i) => (
            <span
              key={label}
              className="wh-axis-tick"
              style={{
                left:
                  seasonLabels.length <= 1
                    ? '50%'
                    : `${(i / (seasonLabels.length - 1)) * 100}%`,
              }}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="wh-axis-spacer-right" />
      </div>

      <div className="wh-rows" role="list">
        {renderableMetrics.map(m => (
          <MetricRow
            key={m.key}
            metric={m}
            series={buildSeries(m, ordered)}
            compact={compact}
          />
        ))}
      </div>

      {!compact && (
        <p className="wh-footer">
          Each row is one metric across {ordered.length} season
          {ordered.length === 1 ? '' : 's'}. Per-row Y-axis is autoscaled
          (each metric&apos;s own range). Component values normalized to
          per-82 for cross-season comparability.
          {history.length < seasons && (
            <>
              {' '}Showing {history.length} of {seasons} requested seasons —
              the others either have no built artifact yet or this player
              wasn&apos;t rostered.
            </>
          )}
        </p>
      )}
    </div>
  );
}
