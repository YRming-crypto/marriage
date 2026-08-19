import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { LogOut, MapPin, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { mainNavigation } from "../app/navigation";
import { getMe, getNotifications, logout } from "../api/client";
import { cities } from "../data/members";
import { Brand } from "./Brand";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const skipNextSessionRefresh = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const currentCity = searchParams.get("city") ?? "上海";
  const cityOptions = [...new Set(cities.filter((city) => city !== "不限"))];

  function handleCityChange(event: ChangeEvent<HTMLSelectElement>) {
    const city = event.target.value;
    if (!city || city === "全部城市") {
      navigate("/find");
      return;
    }
    navigate(`/find?city=${encodeURIComponent(city)}`);
  }

  useEffect(() => {
    if (skipNextSessionRefresh.current) {
      skipNextSessionRefresh.current = false;
      return;
    }
    let active = true;
    getMe()
      .then(async (result) => {
        if (!active) return;
        setAccountName(result.profile?.nickname?.trim() || "我的账户");
        try {
          const notifications = await getNotifications();
          if (active) setUnreadCount(Math.max(0, Math.floor(notifications.unreadCount)));
        } catch {
          if (active) setUnreadCount(0);
        }
      })
      .catch(() => {
        if (active) {
          setAccountName(null);
          setUnreadCount(0);
        }
      });
    return () => { active = false; };
  }, [location.pathname]);

  useEffect(() => {
    function handleNotificationsUpdated(event: Event) {
      const unreadCount = (event as CustomEvent<{ unreadCount?: number }>).detail?.unreadCount;
      if (typeof unreadCount === "number" && Number.isFinite(unreadCount)) {
        setUnreadCount(Math.max(0, Math.floor(unreadCount)));
      }
    }

    window.addEventListener("ai-marriage-notifications-updated", handleNotificationsUpdated);
    return () => window.removeEventListener("ai-marriage-notifications-updated", handleNotificationsUpdated);
  }, []);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
      localStorage.removeItem("ai-marriage-auth-user");
      sessionStorage.removeItem("ai-marriage-auth-profile");
      setAccountName(null);
      setUnreadCount(0);
      skipNextSessionRefresh.current = true;
      navigate("/");
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "退出登录失败，请稍后重试。");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="shell utility-bar__inner">
          <span><ShieldCheck size={16} /> 资料审核与隐私保护</span>
          <label className="city-picker">
            <MapPin size={16} />
            <select value={currentCity} onChange={handleCityChange} aria-label="切换定位城市">
              <option value="全部城市">全部城市</option>
              {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="shell masthead">
        <Brand />
        <nav id="main-navigation" className={`main-nav ${open ? "is-open" : ""}`} aria-label="主导航">
          <div className="main-nav__inner">
            {mainNavigation.map((item) => {
              const isMessages = item.to === "/messages";
              const unreadLabel = isMessages && unreadCount > 0 ? `消息，${unreadCount} 条未读提醒` : undefined;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  aria-label={unreadLabel}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => isActive ? "is-active" : undefined}
                >
                  {item.label}
                  {isMessages && unreadCount > 0 ? <b className="nav-unread-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</b> : null}
                </NavLink>
              );
            })}
          </div>
        </nav>
        <div className="masthead__actions">
          {accountName ? <>
            <NavLink className="text-action" to="/me"><UserRound size={18} />{accountName}</NavLink>
            <button className="icon-button" type="button" title="退出登录" aria-label="退出登录" disabled={loggingOut} onClick={() => void handleLogout()}><LogOut /></button>
          </> : <>
            <NavLink className="text-action" to="/auth">登录</NavLink>
            <NavLink className="button button--primary button--small" to="/onboarding">免费加入</NavLink>
          </>}
          <button
            className="menu-button"
            type="button"
            aria-expanded={open}
            aria-controls="main-navigation"
            aria-label={open ? "关闭主菜单" : "打开主菜单"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      {logoutError ? <p className="shell form-tip" role="alert" aria-label="退出登录失败">{logoutError}</p> : null}
    </header>
  );
}
