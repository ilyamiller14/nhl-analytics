import { formatSeasonId } from '../utils/formatters';
import './SeasonSelector.css';

interface SeasonSelectorProps {
  seasons: number[];
  selectedSeason: number;
  onSeasonChange: (season: number) => void;
}

function SeasonSelector({ seasons, selectedSeason, onSeasonChange }: SeasonSelectorProps) {
  if (seasons.length === 0) {
    return null;
  }

  return (
    <div className="season-selector">
      <label htmlFor="season-select" className="season-label">
        Season:
      </label>
      <select
        id="season-select"
        value={selectedSeason}
        onChange={(e) => onSeasonChange(parseInt(e.target.value, 10))}
        className="season-select"
      >
        {seasons.map((season) => (
          <option key={season} value={season}>
            {formatSeasonId(season)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default SeasonSelector;
