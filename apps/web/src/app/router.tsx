import { useEffect, useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { createBrowserRouter, Navigate, Outlet, useLocation, type RouteObject } from "react-router-dom";
import { ApiError, getMe } from "../api/client";
import { AppShell } from "../components/AppShell";
import { AvatarChatPage } from "../pages/AvatarChatPage";
import { AvatarProfilePage } from "../pages/AvatarProfilePage";
import { AdminReviewPage } from "../pages/AdminReviewPage";
import { AccountSecurityPage } from "../pages/AccountSecurityPage";
import {
  ActivitiesPage,
  AuthPage,
  ClassroomPage,
  MomentsPage,
  PrivacyPolicyPage,
  SafetyPage,
  StoriesPage,
  TopicPlazaPage,
  UserAgreementPage,
} from "../pages/ContentPages";
import { FindPage } from "../pages/FindPage";
import { HomePage } from "../pages/HomePage";
import { MatchmakingPage } from "../pages/MatchmakingPage";
import { MePage } from "../pages/MePage";
import { MemberPage } from "../pages/MemberPage";
import { MessagesPage } from "../pages/MessagesPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { OnboardingPage } from "../pages/OnboardingPage";
import { SoulTestPage } from "../pages/SoulTestPage";
import { DailyPickPage } from "../pages/DailyPickPage";
import { MiniGamesPage } from "../pages/MiniGamesPage";
import { TaskCenterPage } from "../pages/TaskCenterPage";
import { VipPage } from "../pages/VipPage";
import { ErrorRecoveryPage } from "./GlobalErrorBoundary";
import { RequireAuthentication, RequireReviewer } from "./RouteGuards";

function RestrictInactiveAccounts() {
  const location = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [access, setAccess] = useState<"checking" | "allowed" | "restricted" | "error">("checking");

  useEffect(() => {
    let active = true;
    setAccess("checking");
    void getMe()
      .then((account) => {
        if (active) setAccess(account.user.status === "active" ? "allowed" : "restricted");
      })
      .catch((error: unknown) => {
        if (!active) return;
        const signedOut = error instanceof ApiError && error.code === "AUTH_REQUIRED" && error.status === 401;
        setAccess(signedOut ? "allowed" : "error");
      });

    return () => {
      active = false;
    };
  }, [attempt, location.pathname]);

  if (access === "restricted") return <Navigate replace to="/me/security" />;
  if (access === "error") {
    return (
      <div className="page-shell shell">
        <div className="empty-state" role="alert">
          <CircleAlert />
          <h1>暂时无法确认账号状态</h1>
          <p>账号服务暂时无法连接。为保护账号安全，匹配内容不会在状态确认前显示。</p>
          <button className="button button--primary" type="button" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw />重新检查
          </button>
        </div>
      </div>
    );
  }
  if (access === "checking") return null;
  return <Outlet />;
}

export const appRoutes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <ErrorRecoveryPage />,
    children: [
      { path: "/", element: <HomePage /> },
      {
        element: <RestrictInactiveAccounts />,
        children: [
          { path: "/find", element: <FindPage /> },
          { path: "/member/:memberId", element: <MemberPage /> },
          { path: "/matchmaking", element: <MatchmakingPage /> },
        ],
      },
      { path: "/moments", element: <MomentsPage /> },
      { path: "/topics", element: <TopicPlazaPage /> },
      { path: "/activities", element: <ActivitiesPage /> },
      { path: "/stories", element: <StoriesPage /> },
      { path: "/classroom", element: <ClassroomPage /> },
      { path: "/safety", element: <SafetyPage /> },
      { path: "/soul-test", element: <SoulTestPage /> },
      { path: "/games", element: <MiniGamesPage /> },
      { path: "/auth", element: <AuthPage /> },
      { path: "/terms", element: <UserAgreementPage /> },
      { path: "/privacy", element: <PrivacyPolicyPage /> },
      {
        element: <RequireAuthentication />,
        children: [
          { path: "/matchmaking/:memberId/chat", element: <AvatarChatPage /> },
          { path: "/me/avatar", element: <AvatarProfilePage /> },
          { path: "/daily-pick", element: <DailyPickPage /> },
          { path: "/tasks", element: <TaskCenterPage /> },
          { path: "/vip", element: <VipPage /> },
          { path: "/messages", element: <MessagesPage /> },
          { path: "/me", element: <MePage /> },
          { path: "/me/security", element: <AccountSecurityPage /> },
          { path: "/onboarding", element: <OnboardingPage /> },
        ],
      },
      {
        element: <RequireReviewer />,
        children: [
          { path: "/admin/review", element: <AdminReviewPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
