import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toPng } from 'html-to-image';
import { usePlayerStats } from '../hooks/usePlayerStats';
import { usePlayerGameData } from '../hooks/usePlayerGameData';
import { useAdvancedPlayerAnalytics } from '../hooks/useAdvancedPlayerAnalytics';
import StatChart from '../components/StatChart';
// IceRinkChart removed - using IceChartsPanel instead
import AdvancedAnalyticsTable from '../components/AdvancedAnalyticsTable';
import AdvancedAnalyticsDashboard from '../components/AdvancedAnalyticsDashboard';
import IceChartsPanel from '../components/IceChartsPanel';
import RollingAnalyticsChart from '../components/charts/RollingAnalyticsChart';
import XGFlowChart from '../components/charts/XGFlowChart';
import PlayerAnalyticsCard from '../components/PlayerAnalyticsCard';
import { useComparison } from '../context/ComparisonContext';
import PlayerSearch from '../components/PlayerSearch';
import ProfileHero from '../components/ProfileHero';
// EDGE charts
import SpeedProfileChart from '../components/charts/SpeedProfileChart';
import ZoneTimeChart from '../components/charts/ZoneTimeChart';
import TrackingRadarChart, { type PlayerTrackingData, type TrackingMetric } from '../components/charts/TrackingRadarChart';
import ShotVelocityChart from '../components/charts/ShotVelocityChart';
import DistanceFatigueChart from '../components/charts/DistanceFatigueChart';
// Deep Analytics (April 2026)
import GoalsAboveExpectedCard from '../components/charts/GoalsAboveExpectedCard';
import HotColdZoneRadial from '../components/charts/HotColdZoneRadial';
import RollingFinishingTrajectory from '../components/charts/RollingFinishingTrajectory';
import WARBreakdown from '../components/charts/WARBreakdown';
import RAPMImpactCard from '../components/charts/RAPMImpactCard';
import LinemateWithWithout from '../components/charts/LinemateWithWithout';
import { usePlayerLinemateChemistry } from '../hooks/usePlayerLinemateChemistry';
import { computeSkaterWAR } from '../services/warService';
import { loadWARTables, recomputeQuantilesWithRAPM, type WARTables } from '../services/warTableService';
import { loadRAPM, type RAPMArtifact } from '../services/rapmService';
import { edgeTrackingService } from '../services/edgeTrackingService';
import { getSkaterAverages } from '../services/leagueAveragesService';
import { EDGE_CACHE, ANALYTICS_CACHE } from '../utils/cacheUtils';
import { computePlayerSurplus } from '../services/surplusValueService';
import { getPlayerContract, getPlayerContractByName } from '../services/contractService';
import { type RollingMetrics } from '../services/rollingAnalytics';
import type { Shot } from '../components/charts/ShotChart';
import type { Hit } from '../components/charts/HitChart';
import type { Faceoff } from '../components/charts/FaceoffChart';
import {
  calculateAge,
  formatPosition,
  formatPlusMinus,
  formatShootingPct,
  formatTOIString,
  formatSeasonId,
  formatSavePct,
} from '../utils/formatters';
import { calculatePointsPerGame } from '../utils/statCalculations';
import { getRadarChartData, getGoalieRadarChartData } from '../services/playerService';
import { getCurrentSeason } from '../utils/seasonUtils';
import './PlayerProfile.css';

// Helper to get NHL regular season stats from seasonTotals
function getNHLSeasons(seasonTotals: any[] | undefined) {
  if (!seasonTotals) return [];
  return seasonTotals
    .filter(s => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
    .sort((a, b) => a.season - b.season);
}

// Format season number to display format
function formatSeasonDisplay(season: number): string {
  const startYear = Math.floor(season / 10000);
  const endYear = season % 10000;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function PlayerProfile() {
  const { playerId } = useParams<{ playerId: string }>();
  const navigate = useNavigate();
  const { addPlayer } = useComparison();
  const [activeTab, setActiveTab] = useState<'stats' | 'charts' | 'analytics' | 'advanced' | 'edge' | 'deep' | 'card'>('stats');
  const [isSharing, setIsSharing] = useState(false);
  const [warTables, setWarTables] = useState<WARTables | null>(null);
  const [rapm, setRapm] = useState<RAPMArtifact | null>(null);
  // Context with quantile tables rebuilt from the post-RAPM WAR
  // distribution. Without this the percentile shown in the breakdown
  // is compared against PRE-RAPM quantiles (biased — every mid-tier
  // player looks like top-30% because RAPM pushed most competitors
  // downward without the quantile table catching up).
  const rapmAdjustedContext = useMemo(() => {
    if (!warTables || !rapm) return warTables?.context ?? null;
    return recomputeQuantilesWithRAPM(warTables, rapm, (row, ctx, r) => {
      const res = computeSkaterWAR(row, ctx, r);
      return { WAR_per_82: res.WAR_per_82, position: res.position };
    });
  }, [warTables, rapm]);

  // Load the WAR tables on mount — used by BOTH the Deep tab's
  // WARBreakdown AND the shareable card's full-width WAR section. If
  // we wait until the Deep tab is clicked, the share card on the
  // Stats tab silently falls back to the old xG-trend/shot-map layout
  // because warTables is still null.
  useEffect(() => {
    if (!warTables) loadWARTables().then(setWarTables);
  }, [warTables]);

  // Load RAPM coefficients once on mount — cached in the service and
  // consumed by the RAPM Impact card. The component renders an empty
  // state while this is pending or if the artifact is unavailable.
  useEffect(() => {
    loadRAPM().then(setRapm);
  }, []);
  const cardRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [cardZoom, setCardZoom] = useState(1);

  // Dynamically compute zoom so the 900px card always fits the container.
  // Depends on activeTab because previewRef.current is null until the card tab renders.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const available = entry.contentRect.width;
        setCardZoom(Math.min(1, available / 900));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeTab]);

  const { data: player, isLoading, error } = usePlayerStats(
    playerId ? parseInt(playerId, 10) : null
  );

  // Computed WAR result for the current player — used by both the deep-
  // tab breakdown and the shareable card's right column.
  const shareWarResult = useMemo(() => {
    if (!warTables || !player) return undefined;
    const row = warTables.skaters[player.playerId];
    if (!row) return undefined;
    const ctx = rapmAdjustedContext ?? warTables.context;
    return computeSkaterWAR(row, ctx, rapm);
  }, [warTables, player, rapm, rapmAdjustedContext]);

  // Reset active tab when player changes
  useEffect(() => {
    setActiveTab('stats');
  }, [playerId]);


  // Handle share functionality
  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;

    setIsSharing(true);

    const fileName = `${player?.firstName.default}-${player?.lastName.default}-analytics.png`;

    const downloadImage = (dataUrl: string) => {
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    const tryShare = async (dataUrl: string) => {
      if (navigator.share) {
        try {
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          const file = new File([blob], fileName, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: `${player?.firstName.default} ${player?.lastName.default} Analytics`,
            });
            return true;
          }
        } catch {
          // Share failed
        }
      }
      return false;
    };

    try {
      // Clone the card into a hidden container at full 900px.
      // We use a clone instead of manipulating the live DOM because
      // React re-renders (from setIsSharing) race with async capture
      // and can wipe out manual style overrides.
      // The clone must be *visible* (not visibility:hidden) for html-to-image
      // to capture it, but hidden from the user. We use a zero-size wrapper
      // with overflow:hidden to clip it visually, while the clone itself is
      // absolutely positioned at 0,0 inside it so mobile browsers still
      // compute full layout (unlike left:-9999px which Safari can skip).
      //
      // 16:9 share target — 1200×675 — so the PNG lands cleanly on
      // Twitter (2:1 crop), iMessage (center square), Discord (full),
      // and any iOS share sheet. Width is fixed because we export at
      // pixel scale 2 → 2400×1350 which downscales gracefully on
      // social previews without text becoming illegible.
      // 1080×1080 square — fits preview windows natively (iMessage,
      // WhatsApp, Twitter/X, Discord, Instagram feed). Previously 1200×675
      // (16:9) which letterboxed with large vertical dead zones in chat
      // previews, making the content appear tiny unless tapped open.
      const SHARE_CARD_WIDTH = 1080;
      const SHARE_CARD_HEIGHT = 1080;
      const original = cardRef.current;

      // index.css has `@media (max-width: 768px) { html { font-size: 14px } }`
      // for responsive typography. rem units inside the card (all the
      // `var(--space-*)` paddings and rem font sizes) inherit that 14px
      // root during capture, producing a visibly cramped mobile PNG.
      // Install a temporary style override that forces html font-size
      // back to 16px AND overrides the card's 16/9 aspect-ratio to 1/1
      // for the square share export. Removed after capture so the live
      // page keeps its mobile styling + on-screen 16:9 preview.
      const rootFontStyle = document.createElement('style');
      rootFontStyle.setAttribute('data-share-capture', 'root-font-lock');
      rootFontStyle.textContent =
        'html{font-size:16px !important}' +
        `[data-share-capture-target]{` +
          `aspect-ratio:1/1 !important;` +
          `width:${SHARE_CARD_WIDTH}px !important;` +
          `max-width:${SHARE_CARD_WIDTH}px !important;` +
          `min-width:${SHARE_CARD_WIDTH}px !important;` +
          `height:${SHARE_CARD_HEIGHT}px !important;` +
          `min-height:${SHARE_CARD_HEIGHT}px !important;` +
          `max-height:${SHARE_CARD_HEIGHT}px !important;` +
          `padding:2.75rem 2.75rem !important;` +
          `gap:1.5rem !important;` +
        `}` +
        // Card is designed for a 16:9 share; its direct children don't
        // flex-grow, so stretching to 1:1 leaves dead space. During
        // capture, force the header row, metrics, bottom columns, and
        // footer to split the height evenly. The footer's native
        // `margin-top:auto` is dropped too — with gap-based
        // distribution it'd double-collapse toward the bottom.
        `[data-share-capture-target] > .card-header-row{flex:0 0 auto !important;margin-bottom:0 !important}` +
        `[data-share-capture-target] > .metrics-row{flex:0 0 auto !important}` +
        `[data-share-capture-target] > .bottom-columns{flex:1 1 auto !important;min-height:0 !important}` +
        `[data-share-capture-target] > .card-footer{flex:0 0 auto !important;margin-top:0 !important;padding-top:1rem !important}` +
        // PlayerAnalyticsCard.css caps the WAR chart at max-height 380px
        // (container) / 240px (svg) to protect the 16:9 layout. In 1:1
        // square mode those caps leave the lower half empty — lift the
        // ceilings so the WAR chart scales to fill.
        `[data-share-capture-target] .bottom-war-full{max-height:none !important;height:100% !important;align-items:stretch !important;overflow:visible !important}` +
        `[data-share-capture-target] .bottom-war-full .share-war-breakdown{height:100% !important}` +
        `[data-share-capture-target] .bottom-war-full .share-war-breakdown .war-break{height:100% !important}` +
        `[data-share-capture-target] .share-war-breakdown svg{max-height:none !important;height:100% !important;width:100% !important}` +
        // Size bump: the card's base design was 16:9 1200×675; at 1080×1080
        // there's more vertical budget, so upsize the hero elements so
        // they read clearly in a small preview thumbnail.
        `[data-share-capture-target] .hero-stat-value{font-size:3.25rem !important;line-height:1 !important}` +
        `[data-share-capture-target] .hero-stat-label{font-size:0.9rem !important}` +
        `[data-share-capture-target] .player-name{font-size:2.25rem !important;line-height:1.15 !important}` +
        `[data-share-capture-target] .card-header-row{gap:1.5rem !important}` +
        `[data-share-capture-target] .player-headshot,[data-share-capture-target] .player-headshot-placeholder{width:112px !important;height:112px !important}` +
        `[data-share-capture-target] .edge-badge-value,[data-share-capture-target] .rate-value{font-size:1.9rem !important}` +
        `[data-share-capture-target] .edge-badge-label,[data-share-capture-target] .rate-label{font-size:0.8rem !important}` +
        `[data-share-capture-target] .card-methodology{font-size:0.85rem !important;line-height:1.45 !important}`;
      document.head.appendChild(rootFontStyle);

      const wrapper = document.createElement('div');
      // html-to-image on mobile Chrome/Safari honors the clone's
      // computed width only when the wrapper is actually part of the
      // layout tree. 0×0 wrappers (overflow:hidden) and transformed
      // off-screen wrappers both cause descendants to inherit the
      // mobile viewport's narrow computed styles, cutting off the
      // sides of the final PNG. Position with `left: -100000px` — fully
      // laid out, never visible, and Chrome/Safari paint it correctly.
      wrapper.style.cssText =
        `position:fixed;left:-100000px;top:0;` +
        `width:${SHARE_CARD_WIDTH}px;height:${SHARE_CARD_HEIGHT}px;` +
        `pointer-events:none;z-index:-9999;background:transparent;` +
        `overflow:visible;`;
      const clone = original.cloneNode(true) as HTMLElement;
      // cardRef points to a wrapper <div style={{zoom}}> that HOLDS the
      // actual .player-analytics-card inside. If we stamp attributes
      // on the clone itself, our CSS rules never hit the card — they
      // end up on the wrapper (which is block, not flex) and the card
      // keeps its original 16:9 aspect. Find the real card element
      // and target it.
      const cardEl = clone.classList.contains('player-analytics-card')
        ? clone
        : (clone.querySelector('.player-analytics-card') as HTMLElement | null);
      if (!cardEl) throw new Error('share capture: .player-analytics-card not found in clone');
      clone.style.cssText =
        `box-sizing:border-box;margin:0;padding:0;` +
        `transform:none;filter:none;font-size:16px;` +
        `width:${SHARE_CARD_WIDTH}px;height:${SHARE_CARD_HEIGHT}px;` +
        `overflow:visible;`;
      // Remove the live zoom style from the capture wrapper — it would
      // double-scale the card on mobile and break the 1080×1080 target.
      clone.style.removeProperty('zoom');
      cardEl.setAttribute('data-share-capture-target', 'true');
      cardEl.style.setProperty('aspect-ratio', '1 / 1', 'important');
      cardEl.style.setProperty('width', `${SHARE_CARD_WIDTH}px`, 'important');
      cardEl.style.setProperty('min-width', `${SHARE_CARD_WIDTH}px`, 'important');
      cardEl.style.setProperty('max-width', `${SHARE_CARD_WIDTH}px`, 'important');
      cardEl.style.setProperty('height', `${SHARE_CARD_HEIGHT}px`, 'important');
      cardEl.style.setProperty('min-height', `${SHARE_CARD_HEIGHT}px`, 'important');
      cardEl.style.setProperty('max-height', `${SHARE_CARD_HEIGHT}px`, 'important');
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);

      // Route cross-origin image srcs (player headshot, team logo)
      // through our worker's /asset passthrough, which echoes the bytes
      // with CORS headers. Without this, html-to-image's fetch-then-
      // embed cycle fails for assets.nhle.com (no ACAO header), the
      // IMG collapses to 0×0, and the card's left column loses the
      // headshot + logo — visually clipping the final PNG.
      const ALLOW_PROXY_HOSTS = new Set([
        'assets.nhle.com',
        'cms.nhl.bamgrid.com',
        'cdn.nhle.com',
      ]);
      const WORKER_BASE = 'https://nhl-api-proxy.deepdivenhl.workers.dev';
      const imgs = Array.from(cardEl.querySelectorAll('img'));
      for (const img of imgs) {
        try {
          const u = new URL(img.src, window.location.href);
          if (ALLOW_PROXY_HOSTS.has(u.host)) {
            img.src = `${WORKER_BASE}/asset?url=${encodeURIComponent(u.toString())}`;
            img.crossOrigin = 'anonymous';
          }
        } catch { /* skip malformed src */ }
      }

      // Wait for the rewritten images to finish loading so html-to-image
      // captures them instead of 0×0 broken-image boxes.
      await Promise.all(imgs.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          // Safety timeout — never block the share forever on a bad asset.
          setTimeout(done, 4000);
        });
      }));

      // Force a layout read on the actual card so the browser computes
      // all descendant widths BEFORE html-to-image snapshots computed
      // styles. Some mobile browsers defer layout until the element is
      // visible and the snapshot sees stale narrow widths.
      void cardEl.getBoundingClientRect();
      void cardEl.offsetWidth;

      // Two frames: first for layout, second for image decode
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));

      let dataUrl: string;
      try {
        dataUrl = await toPng(cardEl, {
          quality: 0.95,
          backgroundColor: '#0c0c1d',
          pixelRatio: 2,
          width: SHARE_CARD_WIDTH,
          height: SHARE_CARD_HEIGHT,
          cacheBust: true,
          includeQueryParams: true,
        });
      } catch {
        console.log('Retrying without external images...');
        dataUrl = await toPng(cardEl, {
          quality: 0.95,
          backgroundColor: '#0c0c1d',
          pixelRatio: 2,
          width: SHARE_CARD_WIDTH,
          height: SHARE_CARD_HEIGHT,
          filter: (node: HTMLElement) => {
            if (node.tagName === 'IMG') {
              const src = (node as HTMLImageElement).src;
              return src.startsWith('data:') || src.startsWith(window.location.origin);
            }
            return true;
          },
        });
      } finally {
        document.body.removeChild(wrapper);
        if (rootFontStyle.parentNode) {
          rootFontStyle.parentNode.removeChild(rootFontStyle);
        }
      }

      // Try to share, fall back to download
      const shared = await tryShare(dataUrl);
      if (!shared) {
        downloadImage(dataUrl);
      }

    } catch (err) {
      console.error('Error generating image:', err);
      alert('Unable to generate image. Please use your browser\'s screenshot feature:\n\n• Mac: Cmd+Shift+4\n• Windows: Win+Shift+S\n• Mobile: Volume+Power buttons');
    } finally {
      // Belt-and-suspenders: remove any stray root-font-lock style left
      // behind if an exception fired before the normal cleanup path ran.
      document
        .querySelectorAll('style[data-share-capture="root-font-lock"]')
        .forEach((el) => el.parentNode?.removeChild(el));
      setIsSharing(false);
    }
  }, [player]);

  // Fetch real shot data from NHL API - must be called before any conditional returns
  const { data: gameData, isLoading: gameDataLoading } = usePlayerGameData(
    player?.playerId || null,
    player?.currentTeamId || null,
    player?.featuredStats?.season?.toString() || getCurrentSeason()
  );

  // Fetch advanced analytics data - must be called before any conditional returns
  const {
    analytics: advancedAnalytics,
    isLoading: analyticsLoading,
    error: analyticsError
  } = useAdvancedPlayerAnalytics(
    player?.playerId || null,
    player?.currentTeamId || null,
    player?.featuredStats?.season?.toString() || getCurrentSeason()
  );

  // Linemate WOWY — loaded lazily when the Deep tab is first opened.
  const {
    result: linemateChemistry,
    isLoading: linemateLoading,
  } = usePlayerLinemateChemistry(
    activeTab === 'deep' && player?.playerId ? player.playerId : null,
    activeTab === 'deep' && player?.currentTeamId ? player.currentTeamId : null,
    activeTab === 'deep' && player?.currentTeamAbbrev ? player.currentTeamAbbrev : null,
    player?.featuredStats?.season?.toString() || getCurrentSeason()
  );

  // Rolling analytics data - computed from advanced analytics hook
  const rollingData: RollingMetrics[] = useMemo(() => {
    // Use rolling metrics from advanced analytics if available
    if (advancedAnalytics?.rollingMetrics && advancedAnalytics.rollingMetrics.length > 0) {
      return advancedAnalytics.rollingMetrics;
    }
    return [];
  }, [advancedAnalytics?.rollingMetrics]);

  // Fetch EDGE tracking data
  const {
    data: edgeData,
    isLoading: edgeLoading,
  } = useQuery({
    queryKey: ['edge-player-detail', player?.playerId],
    queryFn: async () => {
      if (!player?.playerId) return null;
      try {
        return await edgeTrackingService.getAllSkaterData(player.playerId);
      } catch (err) {
        console.warn('EDGE data not available:', err);
        return null;
      }
    },
    enabled: !!player?.playerId && player?.position !== 'G',
    staleTime: EDGE_CACHE.EDGE_PLAYER_DETAIL,
    retry: 1,
  });

  // Fetch real skater averages for percentile computation
  const { data: skaterAverages } = useQuery({
    queryKey: ['skater-averages'],
    queryFn: () => getSkaterAverages(),
    staleTime: ANALYTICS_CACHE.LEAGUE_STATS,
    retry: 1,
  });

  // Fetch contract data (cap hit for display)
  const { data: contractData } = useQuery({
    queryKey: ['player-contract', player?.playerId],
    queryFn: async () => {
      if (!player) return null;
      const result = player.playerId
        ? await getPlayerContract(player.playerId)
        : null;
      if (result) return result;
      return getPlayerContractByName(
        `${player.firstName.default} ${player.lastName.default}`
      );
    },
    enabled: !!player,
    staleTime: ANALYTICS_CACHE.LEAGUE_STATS,
    retry: 1,
  });

  // Fetch surplus value data for the card (skaters only, 5+ GP).
  // Surplus now keys off WAR_per_82 (from shareWarResult) rather than
  // P/GP — captures defense, faceoffs, special teams, and penalty
  // differential, not just offense. `computePlayerSurplus` returns
  // null until the WAR tables are loaded and the player has enough
  // games to produce a stable WAR/82 figure.
  const { data: surplusData } = useQuery({
    queryKey: [
      'player-surplus',
      player?.playerId,
      shareWarResult?.WAR_market_per_82,
      player?.featuredStats?.regularSeason?.subSeason?.gamesPlayed,
    ],
    queryFn: async () => {
      if (!player || !shareWarResult) return null;
      const stats = player.featuredStats?.regularSeason?.subSeason;
      if (!stats || stats.gamesPlayed < 5) return null;
      return computePlayerSurplus(
        player.playerId,
        `${player.firstName.default} ${player.lastName.default}`,
        shareWarResult.WAR_market_per_82,
        player.position,
        stats.gamesPlayed,
      );
    },
    enabled: !!player && player.position !== 'G' && !!shareWarResult,
    staleTime: ANALYTICS_CACHE.LEAGUE_STATS,
    retry: 1,
  });

  // EDGE data is now passed directly to chart components
  // No synthetic data transformation needed - charts use real EDGE aggregates

  // Transform EDGE data for TrackingRadarChart - use API percentiles directly
  const edgeTrackingData: PlayerTrackingData | null = useMemo(() => {
    if (!edgeData?.speed || !player) return null;
    const pos = player.position === 'D' ? 'D' : player.position === 'G' ? 'G' : 'F';

    // Access API percentiles directly from transformed data (extended types)
    const speedData = edgeData.speed as any; // Has percentiles and leagueAvg
    const zoneData = edgeData.zoneTime as any;
    const distanceData = edgeData.distance as any;
    const shotData = edgeData.shotSpeed as any;

    const createMetric = (name: string, key: string, value: number, percentile: number, unit: string, desc: string): TrackingMetric => ({
      name, key, value, percentile, unit, description: desc
    });

    // Calculate OZ% - use percentage directly
    const ozPct = zoneData?.offensiveZonePct || 0;

    // Fast bursts = 18-20 + 20-22
    const fastBursts = (speedData?.bursts18To20 || 0) + (speedData?.bursts20To22 || 0);
    const fastBurstsLeagueAvg = (speedData?.leagueAvg?.bursts18To20 || 0) + (speedData?.leagueAvg?.bursts20To22 || 0);
    // Estimate percentile based on ratio to league avg
    const fastBurstsPct = fastBurstsLeagueAvg > 0 ? Math.min(99, Math.max(1, Math.round(50 + (fastBursts / fastBurstsLeagueAvg - 1) * 50))) : 50;

    return {
      playerId: player.playerId,
      playerName: `${player.firstName.default} ${player.lastName.default}`,
      position: pos as 'F' | 'D' | 'G',
      speed: createMetric('Top Speed', 'speed', speedData?.topSpeed || 0, speedData?.percentiles?.topSpeed || 50, 'mph', 'Maximum skating speed'),
      shotVelocity: createMetric('Shot Speed', 'shotVelocity', shotData?.maxShotSpeed || 0, shotData?.percentiles?.maxShotSpeed || 50, 'mph', 'Hardest shot velocity'),
      distance: createMetric('Distance/60', 'distance', distanceData?.distancePerGame || 0, distanceData?.percentiles?.distancePer60 || 50, 'mi', 'Distance skated per 60 min'),
      zoneControl: createMetric('OZ Time %', 'zoneControl', ozPct, zoneData?.percentiles?.offensiveZonePct || 50, '%', 'Offensive zone time percentage'),
      burstFrequency: createMetric('Elite Bursts', 'burstFrequency', speedData?.bursts22Plus || 0, speedData?.percentiles?.bursts22Plus || 50, '/season', 'Number of 22+ mph bursts'),
      efficiency: createMetric('Fast Bursts', 'efficiency', fastBursts, fastBurstsPct, '/season', 'Number of 18-22 mph bursts'),
    };
  }, [edgeData, player]);


  // Compute dynamic league averages from API data
  const dynamicLeagueAverages = useMemo(() => {
    if (!edgeData?.speed) return null;
    const speedData = edgeData.speed as any;
    const zoneData = edgeData.zoneTime as any;
    const distanceData = edgeData.distance as any;
    const shotData = edgeData.shotSpeed as any;

    const pos = player?.position === 'D' ? 'D' : player?.position === 'G' ? 'G' : 'F';
    const fastBurstsLeagueAvg = (speedData?.leagueAvg?.bursts18To20 || 0) + (speedData?.leagueAvg?.bursts20To22 || 0);

    return {
      position: pos as 'F' | 'D' | 'G',
      speed: speedData?.leagueAvg?.topSpeed ?? 0,
      shotVelocity: shotData?.leagueAvg?.maxShotSpeed ?? 0,
      distance: distanceData?.leagueAvg?.distancePer60 ?? 0,
      zoneControl: zoneData?.leagueAvg?.offensiveZonePct ?? 0,
      burstFrequency: speedData?.leagueAvg?.bursts22Plus ?? 0,
      efficiency: fastBurstsLeagueAvg || 0,
    };
  }, [edgeData, player]);

  // Generate EDGE tracking badges for player header.
  //
  // The NHL EDGE /comparison endpoint returns `leaguePercentile` fields
  // that come through our transformer as 0 (the raw API doesn't surface
  // them reliably at the comparison level). The detailed endpoints DO
  // return real per-metric percentiles, so we read from those instead:
  //   - speed.percentiles.topSpeed        (max speed percentile)
  //   - speed.percentiles.bursts22Plus    (explosiveness)
  //   - distance.percentiles.distancePer60 (workload)
  // Values are on a 0–100 scale already (transformer multiplies by 100).
  const edgeBadges: { label: string; color: string }[] = useMemo(() => {
    if (!edgeData) return [];
    const badges: { label: string; color: string }[] = [];

    const topSpeedPct = edgeData.speed?.percentiles?.topSpeed ?? 0;
    const bursts22PlusPct = edgeData.speed?.percentiles?.bursts22Plus ?? 0;
    const distancePer60Pct = edgeData.distance?.percentiles?.distancePer60 ?? 0;

    if (topSpeedPct >= 90) {
      badges.push({ label: 'Top 10% Speed', color: '#ef4444' });
    } else if (topSpeedPct >= 75) {
      badges.push({ label: 'Elite Skater', color: '#f97316' });
    }

    if (bursts22PlusPct >= 90) {
      badges.push({ label: 'Explosive', color: '#3b82f6' });
    }

    if (distancePer60Pct >= 90) {
      badges.push({ label: 'Workhorse', color: '#10b981' });
    }

    return badges;
  }, [edgeData]);

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="loading">
          <div className="loading-spinner"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="error">
          <h2 className="error-title">Error Loading Player</h2>
          <p className="error-message">{error.message}</p>
          <Link to="/search" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to Search
          </Link>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <h2 className="empty-state-title">Player Not Found</h2>
          <p className="empty-state-message">The requested player could not be found.</p>
          <Link to="/search" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to Search
          </Link>
        </div>
      </div>
    );
  }

  const isGoalie = player.position === 'G';
  const currentSeasonStats = player.featuredStats?.regularSeason?.subSeason;
  const careerStats = player.careerTotals?.regularSeason;
  const playoffStats = player.careerTotals?.playoffs;

  // Get avgToi from seasonTotals (not available in featuredStats.subSeason)
  const currentSeasonId = player.featuredStats?.season;
  const currentSeasonTotals = player.seasonTotals?.find(
    (s) => s.season === currentSeasonId && s.gameTypeId === 2 // 2 = Regular Season
  );
  const avgToi = currentSeasonTotals?.avgToi || currentSeasonStats?.avgToi;

  const age = calculateAge(player.birthDate);
  const ppg = currentSeasonStats && !isGoalie
    ? calculatePointsPerGame(currentSeasonStats.points ?? 0, currentSeasonStats.gamesPlayed)
    : 0;

  // gameData, advancedAnalytics, gameDataLoading, analyticsLoading, and analyticsError
  // are now defined before the early returns above

  // Convert game data for new advanced visualization components
  const mapStrength = (s?: string): 'even' | 'powerplay' | 'shorthanded' | undefined => {
    if (!s) return undefined;
    if (s === '5v5' || s === '4v4' || s === '3v3') return 'even';
    if (s === 'PP') return 'powerplay';
    if (s === 'SH') return 'shorthanded';
    return 'even';
  };

  // Use personalShots for shot chart (player's own shots, not team on-ice shots)
  const advancedShots: Shot[] = gameData?.personalShots.map(shot => ({
    x: shot.x,
    y: shot.y,
    result: shot.type === 'goal' ? 'goal' :
            shot.type === 'shot' ? 'save' :
            shot.type === 'miss' ? 'miss' : 'block',
    xGoal: shot.xGoal,
    shotType: shot.shotType,
    strength: mapStrength(shot.strength),
  })) || [];

  // Hits and faceoffs are not available from the current play-by-play API
  // These are intentionally empty arrays - data not fabricated
  const advancedHits: Hit[] = [];
  const advancedFaceoffs: Faceoff[] = [];

  return (
    <div className="player-profile">
      <ProfileHero
        player={player}
        age={age}
        edgeBadges={edgeBadges}
        onCompare={() => {
          addPlayer(player);
          navigate('/compare');
        }}
      />

      <div className="profile-body">
        <div className="page-container">
          {/* Tabs */}
          <div className="profile-tabs" role="tablist" aria-label="Player profile sections">
            <button
              role="tab"
              aria-selected={activeTab === 'stats'}
              className={`profile-tab ${activeTab === 'stats' ? 'active' : ''}`}
              onClick={() => setActiveTab('stats')}
            >
              Statistics
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'charts'}
              className={`profile-tab ${activeTab === 'charts' ? 'active' : ''}`}
              onClick={() => setActiveTab('charts')}
            >
              Ice Charts {gameDataLoading && <span className="loading-indicator" />}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'analytics'}
              className={`profile-tab ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              Analytics
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'advanced'}
              className={`profile-tab ${activeTab === 'advanced' ? 'active' : ''}`}
              onClick={() => setActiveTab('advanced')}
            >
              Advanced {analyticsLoading && <span className="loading-indicator" />}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'edge'}
              className={`profile-tab ${activeTab === 'edge' ? 'active' : ''}`}
              onClick={() => setActiveTab('edge')}
            >
              EDGE Tracking {edgeLoading && <span className="loading-indicator" />}
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'deep'}
              className={`profile-tab ${activeTab === 'deep' ? 'active' : ''}`}
              onClick={() => setActiveTab('deep')}
            >
              Deep Analytics
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'card'}
              className={`profile-tab ${activeTab === 'card' ? 'active' : ''}`}
              onClick={() => setActiveTab('card')}
            >
              Share Card
            </button>
            {!isGoalie && (
              <Link
                to={`/attack-dna/player/${playerId}`}
                className="profile-tab attack-dna-link"
              >
                Attack DNA
                <span className="new-badge">NEW</span>
              </Link>
            )}
          </div>

          {/* Stats Tab */}
          {activeTab === 'stats' && (
            <>
              {currentSeasonStats && (
                <section className="stats-section">
                  <h2 className="section-title">
                    Current Season ({formatSeasonId(player.featuredStats?.season || 0)})
                  </h2>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-card-label">Games Played</div>
                      <div className="stat-card-value">{currentSeasonStats.gamesPlayed}</div>
                    </div>
                    {isGoalie ? (
                      <>
                        <div className="stat-card highlight">
                          <div className="stat-card-label">Wins</div>
                          <div className="stat-card-value">{currentSeasonStats.wins ?? 0}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">Losses</div>
                          <div className="stat-card-value">{currentSeasonStats.losses ?? 0}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">OTL</div>
                          <div className="stat-card-value">{currentSeasonStats.otLosses ?? 0}</div>
                        </div>
                        <div className="stat-card highlight">
                          <div className="stat-card-label">GAA</div>
                          <div className="stat-card-value">{(currentSeasonStats.goalsAgainstAvg ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="stat-card highlight">
                          <div className="stat-card-label">SV%</div>
                          <div className="stat-card-value">{formatSavePct(currentSeasonStats.savePctg)}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">Shutouts</div>
                          <div className="stat-card-value">{currentSeasonStats.shutouts ?? 0}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="stat-card highlight">
                          <div className="stat-card-label">Goals</div>
                          <div className="stat-card-value">{currentSeasonStats.goals}</div>
                        </div>
                        <div className="stat-card highlight">
                          <div className="stat-card-label">Assists</div>
                          <div className="stat-card-value">{currentSeasonStats.assists}</div>
                        </div>
                        <div className="stat-card highlight">
                          <div className="stat-card-label">Points</div>
                          <div className="stat-card-value">{currentSeasonStats.points}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">+/-</div>
                          <div className="stat-card-value">
                            {formatPlusMinus(currentSeasonStats.plusMinus)}
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">PIM</div>
                          <div className="stat-card-value">{currentSeasonStats.pim}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">Shots</div>
                          <div className="stat-card-value">{currentSeasonStats.shots}</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">Shooting %</div>
                          <div className="stat-card-value">
                            {formatShootingPct(currentSeasonStats.shootingPctg)}
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-card-label">P/GP</div>
                          <div className="stat-card-value">{ppg.toFixed(2)}</div>
                        </div>
                        {avgToi && (
                          <div className="stat-card">
                            <div className="stat-card-label">Avg TOI</div>
                            <div className="stat-card-value">
                              {formatTOIString(avgToi)}
                            </div>
                          </div>
                        )}
                        {currentSeasonStats.powerPlayGoals !== undefined && (
                          <div className="stat-card">
                            <div className="stat-card-label">PP Goals</div>
                            <div className="stat-card-value">{currentSeasonStats.powerPlayGoals}</div>
                          </div>
                        )}
                        {currentSeasonStats.shorthandedGoals !== undefined && (
                          <div className="stat-card">
                            <div className="stat-card-label">SH Goals</div>
                            <div className="stat-card-value">{currentSeasonStats.shorthandedGoals}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>
              )}

              {/* Season History Table */}
              {player.seasonTotals && getNHLSeasons(player.seasonTotals).length > 0 && (
                <>
                  <section className="stats-section">
                    <h2 className="section-title">Season-by-Season Stats</h2>
                    <div className="table-wrapper">
                      <table className="season-history-table">
                        <thead>
                          {isGoalie ? (
                            <tr>
                              <th>Season</th>
                              <th>Team</th>
                              <th style={{ textAlign: 'center' }}>GP</th>
                              <th style={{ textAlign: 'center' }}>W</th>
                              <th style={{ textAlign: 'center' }}>L</th>
                              <th style={{ textAlign: 'center' }}>OTL</th>
                              <th style={{ textAlign: 'center' }}>GAA</th>
                              <th style={{ textAlign: 'center' }}>SV%</th>
                              <th style={{ textAlign: 'center' }}>SO</th>
                            </tr>
                          ) : (
                            <tr>
                              <th>Season</th>
                              <th>Team</th>
                              <th style={{ textAlign: 'center' }}>GP</th>
                              <th style={{ textAlign: 'center' }}>G</th>
                              <th style={{ textAlign: 'center' }}>A</th>
                              <th style={{ textAlign: 'center' }}>PTS</th>
                              <th style={{ textAlign: 'center' }}>+/-</th>
                              <th style={{ textAlign: 'center' }}>PIM</th>
                              <th style={{ textAlign: 'center' }}>P/GP</th>
                            </tr>
                          )}
                        </thead>
                        <tbody>
                          {getNHLSeasons(player.seasonTotals).reverse().map((s, idx) => (
                            <tr key={`${s.season}-${idx}`}>
                              <td>{formatSeasonDisplay(s.season)}</td>
                              <td>{s.teamName?.default || '-'}</td>
                              <td style={{ textAlign: 'center' }}>{s.gamesPlayed}</td>
                              {isGoalie ? (
                                <>
                                  <td style={{ textAlign: 'center' }}>{s.wins ?? '-'}</td>
                                  <td style={{ textAlign: 'center' }}>{s.losses ?? '-'}</td>
                                  <td style={{ textAlign: 'center' }}>{s.otLosses ?? '-'}</td>
                                  <td style={{ textAlign: 'center' }}>{s.goalsAgainstAvg != null ? s.goalsAgainstAvg.toFixed(2) : '-'}</td>
                                  <td style={{ textAlign: 'center' }}>{formatSavePct(s.savePctg)}</td>
                                  <td style={{ textAlign: 'center' }}>{s.shutouts ?? '-'}</td>
                                </>
                              ) : (
                                <>
                                  <td style={{ textAlign: 'center' }}>{s.goals}</td>
                                  <td style={{ textAlign: 'center' }}>{s.assists}</td>
                                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{s.points}</td>
                                  <td style={{ textAlign: 'center', color: s.plusMinus > 0 ? 'green' : s.plusMinus < 0 ? 'red' : 'inherit' }}>
                                    {s.plusMinus > 0 ? '+' : ''}{s.plusMinus}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>{s.pim}</td>
                                  <td style={{ textAlign: 'center' }}>
                                    {s.gamesPlayed > 0 ? (s.points / s.gamesPlayed).toFixed(2) : '0.00'}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {currentSeasonStats && (
                    <section className="stats-section">
                      <h2 className="section-title">Current Season Performance Radar</h2>
                      <div className="radar-chart-container">
                        <StatChart
                          data={isGoalie
                            ? getGoalieRadarChartData(currentSeasonStats as any)
                            : getRadarChartData(currentSeasonStats as any)}
                          type="radar"
                          dataKeys={[{ key: 'value', name: 'Performance', color: '#003087' }]}
                          xAxisKey="stat"
                          height={400}
                        />
                        <p className="chart-note">
                          Radar chart shows performance relative to NHL elite thresholds. Values are
                          normalized to a 0-100 scale.
                        </p>
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* Career Stats */}
              {careerStats && (
                <section className="stats-section">
                  <h2 className="section-title">Career Regular Season</h2>
                  <div className="career-stats-summary-large">
                    <div className="career-stat">
                      <span className="career-stat-value">{careerStats.gamesPlayed}</span>
                      <span className="career-stat-label">Games</span>
                    </div>
                    {isGoalie ? (
                      <>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.wins ?? '-'}</span>
                          <span className="career-stat-label">Wins</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.losses ?? '-'}</span>
                          <span className="career-stat-label">Losses</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.otLosses ?? '-'}</span>
                          <span className="career-stat-label">OTL</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.goalsAgainstAvg != null ? careerStats.goalsAgainstAvg.toFixed(2) : '-'}</span>
                          <span className="career-stat-label">GAA</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{formatSavePct(careerStats.savePctg)}</span>
                          <span className="career-stat-label">SV%</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.shutouts ?? '-'}</span>
                          <span className="career-stat-label">Shutouts</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.goals}</span>
                          <span className="career-stat-label">Goals</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.assists}</span>
                          <span className="career-stat-label">Assists</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.points}</span>
                          <span className="career-stat-label">Points</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">
                            {formatPlusMinus(careerStats.plusMinus)}
                          </span>
                          <span className="career-stat-label">+/-</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{careerStats.pim}</span>
                          <span className="career-stat-label">PIM</span>
                        </div>
                      </>
                    )}
                  </div>
                </section>
              )}

              {playoffStats && playoffStats.gamesPlayed > 0 && (
                <section className="stats-section">
                  <h2 className="section-title">Career Playoffs</h2>
                  <div className="career-stats-summary-large">
                    <div className="career-stat">
                      <span className="career-stat-value">{playoffStats.gamesPlayed}</span>
                      <span className="career-stat-label">Games</span>
                    </div>
                    {isGoalie ? (
                      <>
                        <div className="career-stat">
                          <span className="career-stat-value">{playoffStats.wins ?? '-'}</span>
                          <span className="career-stat-label">Wins</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{playoffStats.losses ?? '-'}</span>
                          <span className="career-stat-label">Losses</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{playoffStats.goalsAgainstAvg != null ? playoffStats.goalsAgainstAvg.toFixed(2) : '-'}</span>
                          <span className="career-stat-label">GAA</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{playoffStats.shutouts ?? '-'}</span>
                          <span className="career-stat-label">Shutouts</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="career-stat">
                          <span className="career-stat-value">{playoffStats.goals}</span>
                          <span className="career-stat-label">Goals</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{playoffStats.assists}</span>
                          <span className="career-stat-label">Assists</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{playoffStats.points}</span>
                          <span className="career-stat-label">Points</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">
                            {formatPlusMinus(playoffStats.plusMinus)}
                          </span>
                          <span className="career-stat-label">+/-</span>
                        </div>
                        <div className="career-stat">
                          <span className="career-stat-value">{playoffStats.pim}</span>
                          <span className="career-stat-label">PIM</span>
                        </div>
                      </>
                    )}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Ice Charts Tab - Advanced Visualizations */}
          {activeTab === 'charts' && (
            <section className="stats-section">
              <IceChartsPanel
                shots={advancedShots}
                hits={advancedHits}
                faceoffs={advancedFaceoffs}
                passes={gameData?.passes || []}
                playerName={`${player.firstName.default} ${player.lastName.default}`}
                gamesAnalyzed={gameData?.gamesProcessed || 0}
                isLoading={gameDataLoading}
              />
            </section>
          )}

          {/* Analytics Charts Tab */}
          {activeTab === 'analytics' && isGoalie && (
            <section className="stats-section">
              <div className="empty-state">
                <h3 className="empty-state-title">Goalie Analytics</h3>
                <p className="empty-state-message">
                  On-ice analytics (Corsi, Fenwick, xG) are designed for skaters. Goalie-specific advanced analytics are not yet available.
                </p>
              </div>
            </section>
          )}
          {activeTab === 'analytics' && !isGoalie && !currentSeasonStats && (
            <section className="stats-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <p style={{ color: '#6b7280' }}>No current season stats available for analytics.</p>
            </section>
          )}
          {activeTab === 'analytics' && !isGoalie && currentSeasonStats && (
            <section className="stats-section">
              <AdvancedAnalyticsTable
                goals={currentSeasonStats.goals}
                assists={currentSeasonStats.assists}
                points={currentSeasonStats.points}
                shots={currentSeasonStats.shots || 0}
                plusMinus={currentSeasonStats.plusMinus || 0}
                toiMinutes={(typeof avgToi === 'string' && avgToi.includes(':')
                  ? parseFloat(avgToi.split(':')[0]) + parseFloat(avgToi.split(':')[1]) / 60
                  : 0) * currentSeasonStats.gamesPlayed}
                gamesPlayed={currentSeasonStats.gamesPlayed}
                position={player.position}
                playerName={`${player.firstName.default} ${player.lastName.default}`}
                realShotsFor={gameData?.shotsFor || []}
                realShotsAgainst={gameData?.shotsAgainst || []}
                gamesAnalyzed={gameData?.gamesProcessed || 0}
              />
            </section>
          )}

          {/* Advanced Analytics Tab */}
          {activeTab === 'advanced' && (
            <section className="stats-section">
              {analyticsLoading && (
                <div className="loading">
                  <div className="loading-spinner"></div>
                  <p>Calculating advanced analytics from play-by-play data...</p>
                </div>
              )}

              {analyticsError && (
                <div className="error">
                  <h3 className="error-title">Error Loading Advanced Analytics</h3>
                  <p className="error-message">{analyticsError.message}</p>
                </div>
              )}

              {!analyticsLoading && !analyticsError && advancedAnalytics && (
                <AdvancedAnalyticsDashboard
                  analytics={advancedAnalytics}
                  playerName={`${player.firstName.default} ${player.lastName.default}`}
                />
              )}

              {!analyticsLoading && !analyticsError && !advancedAnalytics && (
                <div className="empty-state">
                  <h3 className="empty-state-title">No Analytics Available</h3>
                  <p className="empty-state-message">
                    Advanced analytics data is not available for this player in the current season.
                  </p>
                </div>
              )}

              {/* xG Flow Chart - Cumulative Expected Goals */}
              {rollingData.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <XGFlowChart
                    data={rollingData}
                    playerName={`${player.firstName.default} ${player.lastName.default}`}
                  />
                </div>
              )}

              {/* Rolling Analytics Time Series */}
              {rollingData.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <RollingAnalyticsChart
                    data={rollingData}
                    windowSize={10}
                    playerName={`${player.firstName.default} ${player.lastName.default}`}
                  />
                </div>
              )}
            </section>
          )}

          {/* EDGE Tracking Tab */}
          {activeTab === 'edge' && (
            <section className="stats-section">
              {edgeLoading && (
                <div className="loading">
                  <div className="loading-spinner"></div>
                  <p>Loading EDGE tracking data...</p>
                </div>
              )}

              {!edgeLoading && !edgeData && (
                <div className="empty-state">
                  <h3 className="empty-state-title">No EDGE Tracking Data</h3>
                  <p className="empty-state-message">
                    {isGoalie
                      ? 'EDGE tracking data is for skaters only. Goalie-specific tracking metrics are not currently available.'
                      : 'NHL EDGE tracking data is not available for this player. This data requires the player to have appeared in games tracked by NHL EDGE.'}
                  </p>
                </div>
              )}

              {!edgeLoading && edgeData && (
                <div className="edge-tracking-content">
                  <h2 className="section-title">NHL EDGE Player Tracking</h2>
                  <p className="section-description">
                    Real-time puck and player tracking data from NHL EDGE technology.
                  </p>

                  {/* Speed Profile - REAL EDGE DATA */}
                  {edgeData.speed && (
                    <div className="edge-chart-section">
                      <SpeedProfileChart
                        speedData={edgeData.speed}
                        playerName={`${player.firstName.default} ${player.lastName.default}`}
                        topSkatingSpeeds={(edgeData.speed as any).topSkatingSpeeds}
                      />
                    </div>
                  )}

                  {/* Zone Time - REAL EDGE DATA */}
                  {edgeData.zoneTime && (
                    <div className="edge-chart-section" style={{ marginTop: '2rem' }}>
                      <ZoneTimeChart
                        zoneData={edgeData.zoneTime}
                        playerName={`${player.firstName.default} ${player.lastName.default}`}
                        zoneStarts={(edgeData.zoneTime as any).zoneStarts}
                      />
                    </div>
                  )}

                  {/* Tracking Radar Chart */}
                  {edgeTrackingData && (
                    <div className="edge-chart-section" style={{ marginTop: '2rem' }}>
                      <TrackingRadarChart
                        playerData={edgeTrackingData}
                        leagueAverage={dynamicLeagueAverages || undefined}
                        position={player.position === 'D' ? 'D' : 'F'}
                        showPercentiles={true}
                      />
                    </div>
                  )}

                  {/* Shot Velocity Chart - REAL EDGE DATA */}
                  {edgeData.shotSpeed && (
                    <div className="edge-chart-section" style={{ marginTop: '2rem' }}>
                      <ShotVelocityChart
                        shotData={edgeData.shotSpeed}
                        playerName={`${player.firstName.default} ${player.lastName.default}`}
                        hardestShots={(edgeData.shotSpeed as any).hardestShots}
                      />
                    </div>
                  )}

                  {/* Distance & Fatigue Chart - REAL EDGE DATA */}
                  {edgeData.distance && (
                    <div className="edge-chart-section" style={{ marginTop: '2rem' }}>
                      <DistanceFatigueChart
                        distanceData={edgeData.distance}
                        playerName={`${player.firstName.default} ${player.lastName.default}`}
                        distanceLast10={(edgeData.distance as any).distanceLast10}
                      />
                    </div>
                  )}

                  {/* EDGE Stats Summary */}
                  <div className="edge-stats-summary" style={{ marginTop: '2rem' }}>
                    <h3 className="subsection-title">Tracking Statistics</h3>
                    <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                      {edgeData.speed && (
                        <>
                          <div className="stat-card" style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Top Speed</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.speed.topSpeed.toFixed(1)} mph</div>
                          </div>
                          <div className="stat-card" style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Bursts 22+ mph</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.speed.bursts22Plus}</div>
                          </div>
                        </>
                      )}
                      {edgeData.distance && (
                        <>
                          <div className="stat-card" style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Distance/60 min</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.distance.distancePerGame.toFixed(2)} mi</div>
                          </div>
                          <div className="stat-card" style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Season Distance</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.distance.totalDistance.toFixed(1)} mi</div>
                          </div>
                        </>
                      )}
                      {edgeData.zoneTime && (
                        <>
                          <div className="stat-card" style={{ padding: '1rem', background: '#fef2f2', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#991b1b' }}>Offensive Zone %</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.zoneTime.offensiveZonePct.toFixed(1)}%</div>
                          </div>
                          <div className="stat-card" style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#1e40af' }}>Defensive Zone %</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.zoneTime.defensiveZonePct.toFixed(1)}%</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                </div>
              )}
            </section>
          )}

          {/* Deep Analytics Tab — signature visuals built from this season's real play-by-play */}
          {activeTab === 'deep' && (
            <section className="stats-section deep-analytics">
              <h2 className="section-title">Deep Analytics</h2>
              <p className="section-description">
                Four views of finishing that surface streak shape, directional strengths, and trajectory — not available on MoneyPuck, NHL EDGE, or HockeyViz.
              </p>

              {advancedAnalytics && advancedAnalytics.playerShots.length > 0 ? (
                <>
                  {!isGoalie && (() => {
                    if (!warTables) {
                      return (
                        <div className="deep-panel">
                          <div className="loading" style={{ padding: '1rem 0' }}>
                            <div className="loading-spinner"></div>
                            <p>Loading season-wide WAR tables from worker…</p>
                          </div>
                        </div>
                      );
                    }
                    const row = warTables.skaters[player.playerId];
                    if (!row) {
                      return (
                        <div className="deep-panel">
                          <div className="empty-state">
                            <p>No WAR data for this player yet — likely hasn&apos;t played the 5-game minimum for league inclusion.</p>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="deep-panel">
                        <WARBreakdown
                          title="Wins Above Replacement"
                          playerName={`${player.firstName.default} ${player.lastName.default}`}
                          result={computeSkaterWAR(row, rapmAdjustedContext ?? warTables.context, rapm)}
                        />
                      </div>
                    );
                  })()}

                  <div className="deep-panel">
                    <RAPMImpactCard
                      playerId={player.playerId}
                      playerName={`${player.firstName.default} ${player.lastName.default}`}
                      position={player.position}
                      rapm={rapm}
                    />
                  </div>

                  <div className="deep-panel">
                    <GoalsAboveExpectedCard
                      title="Finishing summary"
                      shots={advancedAnalytics.playerShots}
                    />
                  </div>

                  <div className="deep-panel">
                    <RollingFinishingTrajectory
                      title="Cumulative finishing trajectory"
                      shots={advancedAnalytics.playerShots}
                    />
                  </div>

                  <div className="deep-panel">
                    <HotColdZoneRadial
                      title="Hot/Cold Zones — directional shooting talent"
                      shots={advancedAnalytics.playerShots}
                    />
                  </div>

                  {!isGoalie && (
                    <div className="deep-panel">
                      {linemateLoading && !linemateChemistry ? (
                        <div className="loading" style={{ padding: '1rem 0' }}>
                          <div className="loading-spinner"></div>
                          <p>Loading linemate chemistry…</p>
                        </div>
                      ) : linemateChemistry && linemateChemistry.pairs.length > 0 ? (
                        <LinemateWithWithout
                          title={`Linemate With/Without — ${linemateChemistry.gamesAnalyzed} games`}
                          focusPlayerId={player.playerId}
                          focusPlayerName={`${player.firstName.default} ${player.lastName.default}`}
                          pairs={linemateChemistry.pairs}
                        />
                      ) : (
                        <div className="empty-state">
                          <p>No linemate chemistry yet — not enough shared ice time in the loaded games.</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <p>Play-by-play shot data is still loading or unavailable.</p>
                </div>
              )}
            </section>
          )}

          {/* Share Card Tab */}
          {activeTab === 'card' && !currentSeasonStats && (
            <section className="stats-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <p style={{ color: '#6b7280' }}>No current season stats available for the share card.</p>
            </section>
          )}
          {activeTab === 'card' && currentSeasonStats && (
            <section className="stats-section">
              <div className="card-section">
                <h2 className="section-title">Shareable Analytics Card</h2>
                <p className="section-description">
                  A compact summary of key stats and advanced analytics, designed for sharing on social media.
                </p>

                {/* Player Search */}
                <div className="card-search-section">
                  <h3 className="subsection-title">Search Another Player</h3>
                  <PlayerSearch
                    placeholder="Search for a player..."
                    onPlayerSelect={(selectedPlayer) => {
                      navigate(`/player/${selectedPlayer.playerId}`);
                      setActiveTab('card');
                    }}
                  />
                </div>

                <div className="card-preview" ref={previewRef}>
                  <div ref={cardRef} style={{ zoom: cardZoom }}>
                  <PlayerAnalyticsCard
                    playerId={player.playerId}
                    playerName={`${player.firstName.default} ${player.lastName.default}`}
                    playerNumber={player.sweaterNumber}
                    position={formatPosition(player.position)}
                    teamName={player.fullTeamName?.default || player.currentTeamAbbrev || ''}
                    teamAbbrev={player.currentTeamAbbrev || ''}
                    teamLogo={player.teamLogo}
                    headshot={player.headshot}
                    season={formatSeasonId(player.featuredStats?.season || 0)}
                    gamesPlayed={currentSeasonStats.gamesPlayed}
                    goals={currentSeasonStats.goals}
                    assists={currentSeasonStats.assists}
                    points={currentSeasonStats.points}
                    plusMinus={currentSeasonStats.plusMinus || 0}
                    analytics={advancedAnalytics || undefined}
                    rollingMetrics={rollingData}
                    pointsPerGame={ppg}
                    goalsPerGame={currentSeasonStats.gamesPlayed > 0 ? currentSeasonStats.goals / currentSeasonStats.gamesPlayed : 0}
                    avgToi={avgToi}
                    shots={currentSeasonStats.shots}
                    powerPlayGoals={currentSeasonStats.powerPlayGoals}
                    gameWinningGoals={currentSeasonStats.gameWinningGoals}
                    skaterAverages={skaterAverages}
                    edgeSpeed={edgeData?.speed ? {
                      topSpeed: edgeData.speed.topSpeed,
                      percentile: (edgeData.speed as any).percentiles?.topSpeed || 0,
                    } : null}
                    edgeShotSpeed={edgeData?.shotSpeed ? {
                      maxShotSpeed: edgeData.shotSpeed.maxShotSpeed,
                      percentile: (edgeData.shotSpeed as any).percentiles?.maxShotSpeed || 0,
                    } : null}
                    edgeDistance={edgeData?.distance ? {
                      distancePer60: edgeData.distance.distancePerGame,
                      percentile: (edgeData.distance as any).percentiles?.distancePer60 || 0,
                    } : null}
                    capHit={contractData?.contract.capHit ?? surplusData?.capHit}
                    surplus={surplusData?.surplus}
                    surplusPercentile={surplusData?.surplusPercentile}
                    openMarketValue={surplusData?.openMarketValue}
                    earnedSurplus={surplusData?.earnedSurplus}
                    teamSurplus={surplusData?.teamSurplus}
                    isELC={surplusData?.isELC}
                    isRFA={surplusData?.isRFA}
                    modelRmseDollars={surplusData?.modelRmseDollars}
                    warResult={shareWarResult}
                  />
                  </div>
                </div>
                <div className="card-actions">
                  <button
                    className="btn btn-primary share-btn"
                    onClick={handleShare}
                    disabled={isSharing}
                  >
                    {isSharing ? 'Generating...' : 'Share / Download'}
                  </button>
                  <p className="card-tip">
                    Click the button to share directly or download as an image.
                  </p>
                </div>
              </div>
            </section>
          )}

          <div className="profile-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                addPlayer(player);
                navigate('/compare');
              }}
            >
              Add to Comparison
            </button>
            <Link to="/search" className="btn btn-secondary">
              Search Another Player
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlayerProfile;
