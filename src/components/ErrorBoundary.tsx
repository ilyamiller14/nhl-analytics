import { Component, type ReactNode, type ErrorInfo } from 'react';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Reusable error boundary — wraps route-level components so one page
 * crashing doesn't take down the entire app.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // Auto-reload on chunk load failure (stale deployment)
    const isChunkError =
      error.message?.includes('Failed to fetch dynamically imported module') ||
      error.message?.includes('Importing a module script failed') ||
      error.name === 'ChunkLoadError';

    if (isChunkError) {
      const lastReload = sessionStorage.getItem('chunk-error-reload');
      if (!lastReload || Date.now() - parseInt(lastReload) > 10000) {
        sessionStorage.setItem('chunk-error-reload', Date.now().toString());
        window.location.reload();
      }
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="error-boundary" role="alert">
          <h2 className="error-boundary__title">Something went wrong</h2>
          <p className="error-boundary__message">
            This page encountered an unexpected error. You can try reloading it.
          </p>
          {this.state.error && (
            <pre className="error-boundary__detail">
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            className="btn btn-primary"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
