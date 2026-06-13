import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid light-dark(#ffc9c9, #8b0000)",
            backgroundColor: "light-dark(#fff5f5, #2d0000)",
            color: "light-dark(#c92a2a, #ff6b6b)",
            fontSize: 13,
          }}
        >
          <strong>Render error</strong>
          <p style={{ margin: "4px 0 0", opacity: 0.8, fontSize: 12 }}>
            {this.state.error?.message ?? "Unknown error"}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
