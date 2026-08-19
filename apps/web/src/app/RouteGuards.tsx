import { CircleAlert, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { ApiError, getMe, type GetMeResponse } from "../api/client";

const AUTH_KEY = "ai-marriage-auth-user";
const PROFILE_SESSION_KEY = "ai-marriage-auth-profile";
const ADMINISTRATOR_ROLES: Array<GetMeResponse["user"]["role"]> = ["admin"];
const REVIEWER_ROLES: Array<GetMeResponse["user"]["role"]> = ["admin", "moderator"];

type AccessState =
  | { status: "checking" }
  | { status: "allowed"; userRole: GetMeResponse["user"]["role"] }
  | { status: "signed-out" }
  | { status: "restricted" }
  | { status: "forbidden" }
  | { status: "error" };

function isSignedOutError(error: unknown) {
  return error instanceof ApiError && error.code === "AUTH_REQUIRED";
}

function clearSavedAccount() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(PROFILE_SESSION_KEY);
}

function saveCurrentAccount(account: GetMeResponse) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(account.user));
}

function AccessStatePage({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-shell shell">
      <div className="empty-state" role="alert">
        {icon}
        <h1>{title}</h1>
        <p>{description}</p>
        {action}
      </div>
    </div>
  );
}

function RouteAccessGuard({ privilegedRoles }: { privilegedRoles?: Array<GetMeResponse["user"]["role"]> }) {
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AccessState>({ status: "checking" });
  const checkAccess = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setState({ status: "checking" });

    void getMe()
      .then((account) => {
        if (!active) return;
        saveCurrentAccount(account);
        if (account.user.status !== "active" && location.pathname !== "/me/security") {
          setState({ status: "restricted" });
          return;
        }
        if (privilegedRoles && !privilegedRoles.includes(account.user.role)) {
          setState({ status: "forbidden" });
          return;
        }
        setState({ status: "allowed", userRole: account.user.role });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (isSignedOutError(error)) {
          clearSavedAccount();
          setState({ status: "signed-out" });
          return;
        }
        setState({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [attempt, location.pathname, privilegedRoles]);

  if (state.status === "allowed") return <Outlet context={{ userRole: state.userRole }} />;

  if (state.status === "signed-out") {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate replace to={`/auth?next=${encodeURIComponent(next)}`} />;
  }

  if (state.status === "restricted") return <Navigate replace to="/me/security" />;

  if (state.status === "forbidden") {
    return (
      <AccessStatePage
        icon={<LockKeyhole />}
        title="没有后台访问权限"
        description="当前账号不是管理员，无法查看审核与安全处理后台。"
        action={<Link className="button button--primary button--large" to="/">返回首页</Link>}
      />
    );
  }

  if (state.status === "error") {
    return (
      <AccessStatePage
        icon={<CircleAlert />}
        title="暂时无法确认登录状态"
        description="账号服务暂时无法连接。你的当前位置已保留，请稍后重新检查。"
        action={<button className="button button--primary button--large" type="button" onClick={checkAccess}><RefreshCw />重新检查</button>}
      />
    );
  }

  return (
    <div className="page-shell shell">
      <div className="empty-state" role="status">
        <LoaderCircle />
        <h1>正在确认登录状态</h1>
        <p>请稍候，我们正在安全地恢复你的账号会话。</p>
      </div>
    </div>
  );
}

export function RequireAuthentication() {
  return <RouteAccessGuard />;
}

export function RequireAdministrator() {
  return <RouteAccessGuard privilegedRoles={ADMINISTRATOR_ROLES} />;
}

export function RequireReviewer() {
  return <RouteAccessGuard privilegedRoles={REVIEWER_ROLES} />;
}
