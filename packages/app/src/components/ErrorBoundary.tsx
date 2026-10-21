import { Component, type ReactNode } from 'react';

/** Keeps one broken panel from blanking the whole window. Resets when `resetKey` changes. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null; key?: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { key?: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  render() {
    if (this.state.error) return <div className="pad error">Something went wrong here: {this.state.error.message}</div>;
    return this.props.children;
  }
}
