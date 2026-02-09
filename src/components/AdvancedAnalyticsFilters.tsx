import { useState } from 'react';
import './AdvancedAnalyticsFilters.css';

export interface AnalyticsFilters {
  // Time period
  season: string;
  dateRange: { start: string; end: string } | null;

  // Situation
  strength: 'all' | '5v5' | 'PP' | 'SH' | '4v4' | '3v3';
  scoreState: 'all' | 'leading' | 'trailing' | 'tied';

  // Location
  venue: 'all' | 'home' | 'away';

  // Opponent filters
  conference: 'all' | 'eastern' | 'western';
  division: 'all' | 'atlantic' | 'metropolitan' | 'central' | 'pacific';
  opponent: string | null;

  // Quality filters
  qualityOfCompetition: 'all' | 'top10' | 'top20' | 'bottom10';

  // Zone start adjustments
  zoneStart: 'all' | 'offensive' | 'defensive' | 'neutral';
}

interface AdvancedAnalyticsFiltersProps {
  filters: AnalyticsFilters;
  onFiltersChange: (filters: AnalyticsFilters) => void;
  availableSeasons: string[];
}

function AdvancedAnalyticsFilters({
  filters,
  onFiltersChange,
  availableSeasons,
}: AdvancedAnalyticsFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateFilter = (key: keyof AnalyticsFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const resetFilters = () => {
    onFiltersChange({
      season: 'all',
      dateRange: null,
      strength: 'all',
      scoreState: 'all',
      venue: 'all',
      conference: 'all',
      division: 'all',
      opponent: null,
      qualityOfCompetition: 'all',
      zoneStart: 'all',
    });
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters.strength !== 'all') count++;
    if (filters.scoreState !== 'all') count++;
    if (filters.venue !== 'all') count++;
    if (filters.conference !== 'all') count++;
    if (filters.division !== 'all') count++;
    if (filters.opponent) count++;
    if (filters.qualityOfCompetition !== 'all') count++;
    if (filters.zoneStart !== 'all') count++;
    return count;
  };

  return (
    <div className="analytics-filters">
      <div className="filters-header">
        <div className="filters-title">
          <span className="filters-icon">🔍</span>
          <h3>Analytics Filters</h3>
          {getActiveFilterCount() > 0 && (
            <span className="filter-badge">{getActiveFilterCount()} active</span>
          )}
        </div>
        <div className="filters-actions">
          <button
            className="btn-toggle-advanced"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼ Hide Advanced' : '▶ Show Advanced'}
          </button>
          <button className="btn-reset-filters" onClick={resetFilters}>
            Reset All
          </button>
        </div>
      </div>

      {/* Quick Filters */}
      <div className="quick-filters">
        <div className="filter-group">
          <label>Season</label>
          <select
            value={filters.season}
            onChange={(e) => updateFilter('season', e.target.value)}
          >
            <option value="all">All Seasons</option>
            {availableSeasons.map((season) => (
              <option key={season} value={season}>
                {season}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Strength</label>
          <select
            value={filters.strength}
            onChange={(e) => updateFilter('strength', e.target.value)}
          >
            <option value="all">All Situations</option>
            <option value="5v5">5v5</option>
            <option value="PP">Power Play</option>
            <option value="SH">Shorthanded</option>
            <option value="4v4">4v4</option>
            <option value="3v3">3v3</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Venue</label>
          <select
            value={filters.venue}
            onChange={(e) => updateFilter('venue', e.target.value)}
          >
            <option value="all">All Games</option>
            <option value="home">Home</option>
            <option value="away">Away</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Score State</label>
          <select
            value={filters.scoreState}
            onChange={(e) => updateFilter('scoreState', e.target.value)}
          >
            <option value="all">All Scores</option>
            <option value="leading">Leading</option>
            <option value="trailing">Trailing</option>
            <option value="tied">Tied</option>
          </select>
        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="advanced-filters">
          <div className="filters-section">
            <h4>Opponent Filters</h4>
            <div className="filter-grid">
              <div className="filter-group">
                <label>Conference</label>
                <select
                  value={filters.conference}
                  onChange={(e) => updateFilter('conference', e.target.value)}
                >
                  <option value="all">All Conferences</option>
                  <option value="eastern">Eastern Conference</option>
                  <option value="western">Western Conference</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Division</label>
                <select
                  value={filters.division}
                  onChange={(e) => updateFilter('division', e.target.value)}
                >
                  <option value="all">All Divisions</option>
                  <option value="atlantic">Atlantic</option>
                  <option value="metropolitan">Metropolitan</option>
                  <option value="central">Central</option>
                  <option value="pacific">Pacific</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Specific Opponent</label>
                <select
                  value={filters.opponent || ''}
                  onChange={(e) => updateFilter('opponent', e.target.value || null)}
                >
                  <option value="">All Opponents</option>
                  <option value="TOR">Toronto Maple Leafs</option>
                  <option value="BOS">Boston Bruins</option>
                  <option value="TBL">Tampa Bay Lightning</option>
                  <option value="EDM">Edmonton Oilers</option>
                  <option value="COL">Colorado Avalanche</option>
                  <option value="VGK">Vegas Golden Knights</option>
                  <option value="NYR">New York Rangers</option>
                  <option value="CAR">Carolina Hurricanes</option>
                  <option value="DAL">Dallas Stars</option>
                  <option value="FLA">Florida Panthers</option>
                </select>
              </div>
            </div>
          </div>

          <div className="filters-section">
            <h4>Advanced Options</h4>
            <div className="filter-grid">
              <div className="filter-group">
                <label>Quality of Competition</label>
                <select
                  value={filters.qualityOfCompetition}
                  onChange={(e) => updateFilter('qualityOfCompetition', e.target.value)}
                >
                  <option value="all">All Opponents</option>
                  <option value="top10">vs. Top 10 Teams</option>
                  <option value="top20">vs. Top 20 Teams</option>
                  <option value="bottom10">vs. Bottom 10 Teams</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Zone Starts</label>
                <select
                  value={filters.zoneStart}
                  onChange={(e) => updateFilter('zoneStart', e.target.value)}
                >
                  <option value="all">All Starts</option>
                  <option value="offensive">Offensive Zone</option>
                  <option value="defensive">Defensive Zone</option>
                  <option value="neutral">Neutral Zone</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Filters Summary */}
      {getActiveFilterCount() > 0 && (
        <div className="active-filters-summary">
          <div className="summary-label">Active Filters:</div>
          <div className="filter-chips">
            {filters.strength !== 'all' && (
              <span className="filter-chip">
                Strength: {filters.strength}
                <button onClick={() => updateFilter('strength', 'all')}>×</button>
              </span>
            )}
            {filters.scoreState !== 'all' && (
              <span className="filter-chip">
                Score: {filters.scoreState}
                <button onClick={() => updateFilter('scoreState', 'all')}>×</button>
              </span>
            )}
            {filters.venue !== 'all' && (
              <span className="filter-chip">
                Venue: {filters.venue}
                <button onClick={() => updateFilter('venue', 'all')}>×</button>
              </span>
            )}
            {filters.conference !== 'all' && (
              <span className="filter-chip">
                Conference: {filters.conference}
                <button onClick={() => updateFilter('conference', 'all')}>×</button>
              </span>
            )}
            {filters.division !== 'all' && (
              <span className="filter-chip">
                Division: {filters.division}
                <button onClick={() => updateFilter('division', 'all')}>×</button>
              </span>
            )}
            {filters.opponent && (
              <span className="filter-chip">
                vs. {filters.opponent}
                <button onClick={() => updateFilter('opponent', null)}>×</button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdvancedAnalyticsFilters;
