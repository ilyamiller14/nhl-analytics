import type { MetricGroup } from '../hooks/useComparison';
import './MetricSelector.css';

interface MetricSelectorProps {
  metricGroups: MetricGroup[];
  selectedMetrics: string[];
  onMetricToggle: (metricKey: string) => void;
  maxSelection?: number;
}

function MetricSelector({
  metricGroups,
  selectedMetrics,
  onMetricToggle,
  maxSelection = 10,
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

      <div className="metric-groups">
        {metricGroups.map((group) => (
          <div key={group.label} className="metric-group">
            <span className="group-label">{group.label}</span>
            <div className="group-chips">
              {group.metrics.map((metric) => {
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
                    {metric.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MetricSelector;
