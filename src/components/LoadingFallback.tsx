import './LoadingFallback.css';

export default function LoadingFallback() {
  return (
    <div className="loading-fallback" role="status" aria-live="polite">
      <div className="loading-fallback__spinner" aria-hidden="true" />
      <p className="loading-fallback__text">Loading…</p>
    </div>
  );
}
