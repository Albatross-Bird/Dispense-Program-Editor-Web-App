import React from 'react';

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary.
 * Catches render/effect errors that would otherwise produce a blank white screen.
 * Shows a recoverable error panel so the user can reload without losing the whole window.
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console so it appears in Electron's --enable-logging output
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#111827',
          color: '#f9fafb',
          fontFamily: 'monospace',
          gap: 16,
          padding: 32,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>
          Rendering Error
        </div>
        <pre
          style={{
            fontSize: 11,
            color: '#fca5a5',
            background: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 6,
            padding: '12px 16px',
            maxWidth: 680,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error.message}
          {'\n\n'}
          {error.stack}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            padding: '6px 16px',
            background: '#374151',
            border: '1px solid #4b5563',
            borderRadius: 4,
            color: '#d1d5db',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Try to recover
        </button>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '6px 16px',
            background: '#374151',
            border: '1px solid #4b5563',
            borderRadius: 4,
            color: '#d1d5db',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
