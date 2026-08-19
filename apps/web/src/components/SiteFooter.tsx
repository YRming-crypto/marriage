import { Link } from "react-router-dom";
import { Brand } from "./Brand";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell site-footer__main">
        <div>
          <Brand />
          <p>让每一次认识都有尊重、有边界，也有继续了解的可能。</p>
        </div>
        <div className="site-footer__links" aria-label="页脚链接">
          <Link to="/stories">平台介绍</Link>
          <Link to="/safety">安全中心</Link>
          <Link to="/classroom">婚恋课堂</Link>
          <Link to="/safety">投诉举报</Link>
          <Link to="/terms">用户协议</Link>
          <Link to="/privacy">隐私政策</Link>
        </div>
      </div>
      <div className="shell site-footer__bottom">
        <span>预置资料会标注为演示资料，注册用户数据来自本人建档。</span>
        <span>请勿向陌生人转账，线下见面请选择公共场所。</span>
      </div>
    </footer>
  );
}
