import type { StatCategory } from '../types/stats';
import './MetricSelector.css';

interface MetricSelectorProps {
  availableMetrics: StatCategory[];
  selectedMetrics: string[];
  onMetricToggle: (metricKey: string) => void;
  maxSelection?: number;
}

function MetricSelector({
  availableMetrics,
  selectedMetrics,
  onMetricToggle,
  maxSelection = 6,
}: MetricSelectorProps) {
  const isMaxSelected = selectedMetrics.length >= maxSelection;

  return (
    <div className="metric-selector">
      <div className="metric-selector-header">
        <h3>Select Metrics to Compare</h3>
        <span className="selection-count">
          {selectedMetrics.length} / {maxSelection} selected
        </span>
      </div>

      <div className="metrics-grid">
        {availableMetrics.map((metric) => {
          const isSelected = selectedMetrics.includes(metric.key);
          const isDisabled = !isSelected && isMaxSelected;

          return (
            <button
              key={metric.key}
              onClick={() => !isDisabled && onMetricToggle(metric.key)}
              className={`metric-chip ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
              disabled={isDisabled}
              title={metric.description}
            >
              <span className="metric-label">{metric.label}</span>
              {isSelected && <span className="check-icon">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MetricSelector;
