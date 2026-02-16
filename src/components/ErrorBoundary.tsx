import { Component, type ReactNode, type ErrorInfo } from 'react';

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
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <h2 style={{ color: '#e53e3e', margin: 0 }}>Something went wrong</h2>
          <p style={{ color: '#718096', maxWidth: '400px' }}>
            This page encountered an unexpected error. You can try reloading it.
          </p>
          {this.state.error && (
            <pre style={{
              background: '#1a202c',
              color: '#fc8181',
              padding: '0.75rem 1rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              maxWidth: '500px',
              overflow: 'auto',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReload}
            style={{
              padding: '0.5rem 1.5rem',
              background: '#3182ce',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
