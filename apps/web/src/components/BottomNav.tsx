import { Heart, Home, MessageCircleMore, Sparkles, User } from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import type { ReactNode } from "react";

interface BottomNavItem {
  label: string;
  to: string;
  icon: ReactNode;
  badge?: number;
  matchExact?: boolean;
}

function isActive(pathname: string, to: string, matchExact = false): boolean {
  if (matchExact) return pathname === to;
  return pathname === to || pathname.startsWith(to + "/");
}

export function BottomNav({ notificationCount }: { notificationCount?: number }) {
  const location = useLocation();

  const items: BottomNavItem[] = [
    { label: "首页", to: "/", icon: <Home size={22} />, matchExact: true },
    { label: "匹配", to: "/find", icon: <Sparkles size={22} /> },
    { label: "消息", to: "/messages", icon: <MessageCircleMore size={22} />, badge: notificationCount },
    { label: "动态", to: "/moments", icon: <Heart size={22} /> },
    { label: "我的", to: "/me", icon: <User size={22} /> },
  ];

  // Don't show on auth/onboarding/admin pages
  const hiddenPaths = ["/auth", "/onboarding", "/admin"];
  if (hiddenPaths.some((path) => location.pathname.startsWith(path))) return null;

  return (
    <nav className="bottom-nav" aria-label="底部导航">
      <ul className="bottom-nav__list">
        {items.map(({ label, to, icon, badge, matchExact }) => {
          const active = isActive(location.pathname, to, matchExact);
          return (
            <li key={to}>
              <Link
                className={`bottom-nav__item${active ? " is-active" : ""}`}
                to={to}
                aria-current={active ? "page" : undefined}
              >
                <span className="bottom-nav__icon">
                  {icon}
                  {badge !== undefined && badge > 0 && (
                    <span className="bottom-nav__badge" aria-label={`${badge} 条未读`}>
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span className="bottom-nav__label">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
