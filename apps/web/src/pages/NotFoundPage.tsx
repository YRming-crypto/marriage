import { House, Search, SearchX } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="page-shell shell">
      <div className="empty-state" role="status">
        <SearchX />
        <h1>页面没有找到</h1>
        <p>这个地址可能已经变更，或页面暂时不存在。你可以返回首页，或继续浏览公开会员。</p>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "var(--space-3)" }}>
          <Link className="button button--primary button--large" to="/"><House />返回首页</Link>
          <Link className="button button--soft button--large" to="/find"><Search />浏览匹配大厅</Link>
        </div>
      </div>
    </div>
  );
}
