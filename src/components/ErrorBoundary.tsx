import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Compact fallback (e.g. inside a bubble) instead of a full panel. */
  inline?: boolean;
  label?: string;
}
interface State {
  error: Error | null;
}

/** Keeps one broken component (a weird message payload, say) from blanking the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error(`[${this.props.label ?? "ui"}]`, error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.inline) {
      return (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-1.5 text-xs text-red-700 dark:text-red-300 selectable">
          Couldn't render this {this.props.label ?? "item"}: {error.message}
          <button className="ml-2 underline" onClick={() => this.setState({ error: null })}>
            retry
          </button>
        </div>
      );
    }
    return (
      <div className="flex-1 grid place-items-center p-8 text-sm">
        <div className="max-w-md space-y-2 text-center">
          <div className="font-semibold">Something went wrong in {this.props.label ?? "this view"}</div>
          <div className="text-xs text-red-600 selectable break-words">{error.message}</div>
          <button className="rounded-lg bg-wa-dark text-white px-3 py-1.5 text-xs" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
