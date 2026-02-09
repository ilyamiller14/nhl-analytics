/**
 * Preload Status Indicator
 *
 * Shows a subtle indicator of background preload progress.
 * Appears in the corner and shows how much data is cached.
 */

import { useState, useEffect } from 'react';
import {
  subscribeToPreloadStatus,
  getPreloadStatus,
  type PreloadStatus,
} from '../services/preloadService';
import './PreloadIndicator.css';

export default function PreloadIndicator() {
  const [status, setStatus] = useState<PreloadStatus>(getPreloadStatus());
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToPreloadStatus((newStatus) => {
      setStatus(newStatus);
    });

    return () => unsubscribe();
  }, []);

  // Don't show if nothing is loading and nothing loaded
  if (!status.isLoading && status.teamsLoaded === 0) {
    return null;
  }

  const progressPercent = status.totalTeams > 0
    ? Math.round((status.teamsLoaded / status.totalTeams) * 100)
    : 0;

  const isComplete = !status.isLoading && status.teamsLoaded === status.totalTeams;

  return (
    <div
      className={`preload-indicator ${isExpanded ? 'expanded' : ''} ${isComplete ? 'complete' : ''}`}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="preload-icon">
        {status.isLoading ? (
          <div className="preload-spinner" />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        )}
      </div>

      {isExpanded && (
        <div className="preload-details">
          <div className="preload-title">
            {status.isLoading ? 'Preloading Data...' : 'Data Ready'}
          </div>

          {status.isLoading && (
            <>
              <div className="preload-progress-bar">
                <div
                  className="preload-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="preload-stats">
                <span>{status.teamsLoaded}/{status.totalTeams} teams</span>
                {status.currentTeam && (
                  <span className="preload-current">Loading {status.currentTeam}...</span>
                )}
              </div>
            </>
          )}

          {!status.isLoading && (
            <div className="preload-complete-msg">
              All {status.totalTeams} teams cached
            </div>
          )}
        </div>
      )}

      {!isExpanded && (
        <div className="preload-mini">
          {status.isLoading ? `${progressPercent}%` : ''}
        </div>
      )}
    </div>
  );
}
