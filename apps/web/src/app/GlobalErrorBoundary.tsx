import { CircleAlert, House, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

function RecoveryActions() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "var(--space-3)" }}>
      <button className="button button--primary button--large" type="button" onClick={() => window.location.reload()}>
        <RefreshCw />刷新页面
      </button>
      <a className="button button--soft button--large" href="/">
        <House />返回首页
      </a>
    </div>
  );
}

export function ErrorRecoveryPage() {
  return (
    <main id="main-content" className="page-shell shell">
      <div className="empty-state" role="alert">
        <CircleAlert />
        <h1>页面出了点问题</h1>
        <p>这次加载没有顺利完成。你可以刷新后重试，或先返回首页继续浏览。</p>
        <RecoveryActions />
      </div>
    </main>
  );
}

interface GlobalErrorBoundaryProps {
  children: ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
}

export class GlobalErrorBoundary extends Component<GlobalErrorBoundaryProps, GlobalErrorBoundaryState> {
  state: GlobalErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GlobalErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught application error", error, info);
  }

  render() {
    if (this.state.hasError) return <ErrorRecoveryPage />;
    return this.props.children;
  }
}
