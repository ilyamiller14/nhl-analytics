/**
 * Goalie Analytics Card — sibling to PlayerAnalyticsCard.
 *
 * Reuses the outer chrome (max-width 1200px, aspect-ratio 16/9 in CSS;
 * the share-export flow in PlayerProfile.tsx forces 1080×1080 + the
 * .player-analytics-card / .card-header-row / .metrics-row /
 * .bottom-war-full / .share-war-breakdown / .share-spatial-panel /
 * .card-footer class names so the existing capture pipeline works
 * unmodified) but the data is goalie-shaped:
 *
 *   - Hero triplet: Wins / SV% / GSAx (vs skater PTS / WAR/82 / Surplus)
 *   - Metrics row: GSAx/60 + Quality Start % | GAA + SV% + SA/60
 *   - Bottom: GoalieWARBreakdown (left) + GoalieSpatialPanel (right)
 *   - Footer: same nhl-analytics.pages.dev branding + season + GP
 *
 * Surplus is intentionally NOT computed — surplusValueService short-
 * circuits on position === 'G' because the model isn't fit for goalies.
 * The hero shows cap hit + WAR/82 instead. See `surplusValueService.ts`
 * line ~303 for the gate. A goalie-specific UFA $/WAR ratio is the
 * future-work fix.
 */

import type { GoalieWARResult } from '../services/warService';
import type { GoalieAnalytics } from '../services/goalieAnalytics';
import GoalieWARBreakdown from './charts/GoalieWARBreakdown';
import GoalieSpatialPanel from './charts/GoalieSpatialPanel';
import WARHistoryStrip from './charts/WARHistoryStrip';
import { getTeamPrimaryColor } from '../constants/teams';
import './PlayerAnalyticsCard.css';

interface GoalieFacedShot {
  x: number;
  y: number;
  result: 'goal' | 'shot' | 'miss' | 'block';
  xGoal?: number;
}

interface GoalieAnalyticsCardProps {
  playerId: number;
  playerName: string;
  playerNumber?: number;
  position: string;          // always "G" but kept symmetric with skater card
  teamName: string;
  teamAbbrev: string;
  teamLogo?: string;
  headshot?: string;
  season: string;
  gamesPlayed: number;
  // Hero triplet data + per-60 metrics. All values must come from real
  // computed data (CLAUDE.md hard rule #1) — pass null/undefined for
  // anything missing and the card hides that badge.
  goalieAnalytics?: GoalieAnalytics | null;
  goalieWarResult?: GoalieWARResult;
  shotsFaced?: GoalieFacedShot[];
  // Cap hit display only — no surplus number for v1 (see comment above).
  capHit?: number;
}

function HeroStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="hero-stat">
      <span className="hero-stat-value">{value}</span>
      <span className="hero-stat-label">{label}</span>
      {sub && <span className="hero-stat-sub">{sub}</span>}
    </div>
  );
}

function formatDollars(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

function formatSeasonLabel(s: string): string {
  if (!s || s.length !== 8) return s;
  const start = s.slice(0, 4);
  const endSuffix = s.slice(6, 8);
  return `${start}-${endSuffix} Regular Season`;
}

export default function GoalieAnalyticsCard({
  playerId,
  playerName,
  playerNumber,
  teamName,
  teamAbbrev,
  teamLogo,
  headshot,
  season,
  gamesPlayed,
  goalieAnalytics,
  goalieWarResult,
  shotsFaced,
  capHit,
}: GoalieAnalyticsCardProps) {
  const teamAccent = getTeamPrimaryColor(teamAbbrev);

  // Hero triplet derivations. Wins from goalieAnalytics box-score, SV%
  // displayed as a 3-decimal percentage (".920" → 92.0%), GSAx as a
  // signed cumulative number.
  const wins = goalieAnalytics?.wins ?? null;
  const savePct = goalieAnalytics?.savePct ?? null;
  const gsax = goalieWarResult?.GSAx ?? null;

  // GSAx is the goals-UNDER-expected number — positive means the goalie
  // has stopped MORE shots than the league xG model expected. Show
  // signed (+18.2 / −7.4) so the direction is unambiguous.
  const gsaxStr = gsax != null
    ? `${gsax >= 0 ? '+' : ''}${gsax.toFixed(1)}`
    : '—';

  // Save %: the conventional ".920" goalie display. We show as "92.0%"
  // here for parity with the skater card's "P/GP 1.21"-style decimals.
  const savePctStr = savePct != null && savePct > 0
    ? `${(savePct * 100).toFixed(1)}%`
    : '—';

  return (
    <div
      className="player-analytics-card"
      style={{ ['--team-accent' as never]: teamAccent }}
    >
      {/* ============================================================
          HEADER ROW: identity (left) + hero triplet (right)
          ============================================================ */}
      <div className="card-header-row">
        <div className="header-left">
          <div className="player-identity">
            {headshot ? (
              <img src={headshot} alt={playerName} className="player-headshot" />
            ) : (
              <div className="player-headshot-placeholder">
                {playerName.split(' ').map(n => n[0]).join('')}
              </div>
            )}
            <div className="player-info">
              <h2 className="player-name">{playerName}</h2>
              <div className="player-meta">
                {playerNumber && <span className="player-number">#{playerNumber}</span>}
                <span className="player-position">G</span>
                <span className="player-team">{teamAbbrev}</span>
                <span className="season-badge">{season}</span>
              </div>
              {/* Cap hit display — no surplus number. Goalie surplus is
                  deferred until a goalie UFA $/WAR ratio is fit; see
                  surplusValueService.ts line ~303 (the position === 'G'
                  short-circuit). The label avoids "FAIR VALUE" /
                  "SURPLUS" framing that would imply a number we don't
                  yet compute. */}
              {capHit != null && (
                <div className="surplus-badge">
                  <span className="surplus-cap">{formatDollars(capHit)} AAV</span>
                  {goalieWarResult && goalieWarResult.gamesPlayed > 0 && (
                    <span
                      className="surplus-pct"
                      title={
                        'Goalie surplus is deferred — the surplus model in ' +
                        'surplusValueService.ts short-circuits on goalies because ' +
                        'a goalie UFA $/WAR anchor has not yet been fit. The card ' +
                        'shows cap hit + WAR/82 instead so the workload-vs-cost story ' +
                        'is still visible.'
                      }
                    >
                      {goalieWarResult.WAR_per_82.toFixed(2)} WAR/82
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          {teamLogo && (
            <img src={teamLogo} alt={teamName} className="team-logo-badge" />
          )}
        </div>

        <div className="header-right">
          {/* Hero triplet — Wins / SV% / GSAx. The CLAUDE.md goalie
              brief was explicit: "we definitely need a goals under
              expected metric." GSAx (goals saved above expected =
              goals-UNDER-expected) is that metric. It's surfaced both
              here as the hero number AND as the savePerformance bar in
              the breakdown chart below. */}
          <div className="hero-stats-row">
            <HeroStat
              label="WINS"
              value={wins ?? '—'}
              sub={
                goalieAnalytics
                  ? `${goalieAnalytics.losses}L · ${goalieAnalytics.otLosses}OT`
                  : undefined
              }
            />
            <HeroStat
              label="SV%"
              value={savePctStr}
              sub={
                goalieAnalytics?.goalsAgainstAverage
                  ? `${goalieAnalytics.goalsAgainstAverage.toFixed(2)} GAA`
                  : undefined
              }
            />
            <HeroStat
              label="GSAx"
              value={gsaxStr}
              sub={
                goalieWarResult
                  ? `${goalieWarResult.shotsFaced} shots · ${goalieWarResult.WAR.toFixed(2)} WAR`
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      {/* ============================================================
          METRICS ROW: analytical badges (left) + box-score rates (right)
          Hide any badge whose source data is missing — never fabricate
          (CLAUDE.md hard rule #1).
          ============================================================ */}
      <div className="metrics-row">
        <div className="edge-badges-group">
          {goalieWarResult && goalieWarResult.gamesPlayed > 0 && (
            <div className="edge-badge">
              <span className="edge-badge-value">
                {goalieWarResult.gsaxPer60 >= 0 ? '+' : ''}
                {goalieWarResult.gsaxPer60.toFixed(2)}
              </span>
              <span className="edge-badge-unit">/60</span>
              <span className="edge-badge-label">GSAx Rate</span>
              {goalieWarResult.gsaxPer60Percentile != null && (
                <span className={`edge-badge-pct ${goalieWarResult.gsaxPer60Percentile >= 80 ? 'elite' : goalieWarResult.gsaxPer60Percentile >= 60 ? 'good' : ''}`}>
                  {goalieWarResult.gsaxPer60Percentile.toFixed(0)}th
                </span>
              )}
            </div>
          )}
          {goalieAnalytics && goalieAnalytics.qualityStartPct > 0 && (
            <div className="edge-badge">
              <span className="edge-badge-value">
                {(goalieAnalytics.qualityStartPct * 100).toFixed(0)}
              </span>
              <span className="edge-badge-unit">%</span>
              <span className="edge-badge-label">Quality Start</span>
              <span className="edge-badge-pct">
                {goalieAnalytics.qualityStarts}/{goalieAnalytics.gamesStarted} GS
              </span>
            </div>
          )}
          {goalieAnalytics && goalieAnalytics.shutouts > 0 && (
            <div className="edge-badge">
              <span className="edge-badge-value">{goalieAnalytics.shutouts}</span>
              <span className="edge-badge-unit">SO</span>
              <span className="edge-badge-label">Shutouts</span>
            </div>
          )}
        </div>

        <div className="rate-stats-group">
          <div className="rate-stats">
            {goalieAnalytics && (
              <>
                <div className="rate-stat">
                  <span className="rate-value">
                    {goalieAnalytics.goalsAgainstAverage.toFixed(2)}
                  </span>
                  <span className="rate-label">GAA</span>
                </div>
                <div className="rate-stat">
                  <span className="rate-value">
                    {/* Conventional goalie SV% display: ".912" — three
                        decimal places, leading dot. Hockey audiences read
                        this without the leading "0" so it's the most
                        compact representation that's still unambiguous. */}
                    .{(goalieAnalytics.savePct * 1000).toFixed(0).padStart(3, '0')}
                  </span>
                  <span className="rate-label">SV%</span>
                </div>
                <div className="rate-stat">
                  <span className="rate-value">
                    {goalieAnalytics.shotsAgainstPer60.toFixed(1)}
                  </span>
                  <span className="rate-label">SA/60</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================
          BOTTOM: GoalieWARBreakdown (left) + GoalieSpatialPanel (right),
          plus a 3rd row showing 1-3 seasons of WAR history below.
          Reuses .bottom-war-block / .bottom-war-full / .share-war-* /
          .share-war-history classes so the existing share-export
          flexbox machinery in PlayerAnalyticsCard.css applies cleanly.
          ============================================================ */}
      <>
        <div className={`bottom-war-full${shotsFaced && shotsFaced.length > 0 ? '' : ' bottom-war-full-solo'}`}>
          <div className="share-war-breakdown">
            {goalieWarResult ? (
              <GoalieWARBreakdown
                result={goalieWarResult}
                title="Wins Above Replacement"
                width={640}
                compact
              />
            ) : (
              <div className="war-empty" style={{ padding: '2rem', textAlign: 'center' }}>
                Loading goalie WAR…
              </div>
            )}
          </div>
          {shotsFaced && shotsFaced.length > 0 ? (
            <div className="share-spatial-panel">
              <GoalieSpatialPanel
                shots={shotsFaced}
                width={400}
                height={340}
                smoothSigma={1.4}
              />
            </div>
          ) : (
            // Empty/loading state — keeps the right-column slot present so
            // the WAR chart on the left doesn't reflow to full width.
            <div className="share-spatial-panel">
              <div
                style={{
                  width: 400,
                  height: 340,
                  background: '#0f1218',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: 12,
                }}
              >
                Loading shots faced…
              </div>
            </div>
          )}
        </div>
        {/* 3-year goalie WAR history strip. Same compact mode + same
            visual language as the skater card, so screenshots from a
            skater + goalie scroll read consistently. */}
        <div className="share-war-history">
          <WARHistoryStrip
            playerId={playerId}
            position="G"
            currentSeasonResult={goalieWarResult}
            compact
            title="3-Year WAR/82"
          />
        </div>
      </>

      {/* ============================================================
          FOOTER — same as the skater card so screenshots from both
          cards are visually consistent. Methodology one-liner is
          goalie-specific.
          ============================================================ */}
      <div className="card-footer">
        <div className="card-footer-left">
          <span className="branding">nhl-analytics.pages.dev</span>
          <span className="card-footer-meta">
            {formatSeasonLabel(season)} · Through {gamesPlayed} GP
          </span>
        </div>
        <div className="card-footer-right">
          <span className="card-methodology">
            GSAx = xG faced − goals allowed (empirical xG model). WAR via
            replacement-anchored GSAx ÷ marginal goals/win.
          </span>
        </div>
      </div>
    </div>
  );
}
