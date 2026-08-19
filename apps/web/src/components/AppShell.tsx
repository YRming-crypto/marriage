import { useEffect, useRef, useState } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { DatingAssistant } from "./DatingAssistant";
import { MotionEnhancer } from "./MotionEnhancer";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

const pageTitles: Record<string, string> = {
  "/find": "匹配大厅",
  "/matchmaking": "智能牵线",
  "/messages": "消息",
  "/moments": "动态",
  "/activities": "线下活动",
  "/stories": "幸福案例",
  "/classroom": "婚恋课堂",
  "/safety": "安全中心",
  "/auth": "登录",
  "/terms": "用户协议",
  "/privacy": "隐私政策",
  "/onboarding": "建立婚恋档案",
  "/me": "我的",
  "/me/security": "账号与安全",
  "/me/avatar": "我的 AI 分身",
  "/admin/review": "平台管理",
};

function PageTitleSync() {
  const { pathname } = useLocation();

  useEffect(() => {
    let title = pageTitles[pathname];
    if (!title && pathname.startsWith("/member/")) title = "会员资料";
    if (!title && pathname.startsWith("/matchmaking/") && pathname.endsWith("/chat")) title = "AI 分身聊天";
    document.title = title ? `${title}｜缘来相伴` : "缘来相伴｜认真认识，安心交往";
  }, [pathname]);

  return null;
}

function PageTransition() {
  const location = useLocation();
  const [animate, setAnimate] = useState(false);
  const prevPathname = useRef(location.pathname);

  useEffect(() => {
    if (prevPathname.current !== location.pathname) {
      prevPathname.current = location.pathname;
      setAnimate(true);
      const timer = setTimeout(() => setAnimate(false), 250);
      return () => clearTimeout(timer);
    }
  }, [location.pathname]);

  return (
    <main id="main-content" className={animate ? "page-transition-enter" : undefined}>
      <Outlet />
    </main>
  );
}

export function AppShell() {
  return (
    <MotionEnhancer>
      <PageTitleSync />
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <SiteHeader />
      <PageTransition />
      <SiteFooter />
      <BottomNav />
      <DatingAssistant />
      <ScrollRestoration />
    </MotionEnhancer>
  );
}
