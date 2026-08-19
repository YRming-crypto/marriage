import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountSecurityPage,
  type AccountSecurityApi,
  type AccountSecurityData,
} from "./AccountSecurityPage";

const initialData: AccountSecurityData = {
  accountStatus: "active",
  suspensionSource: null,
  visibility: "approved_only",
  sessions: [
    {
      id: "session-current",
      userAgent: "Chrome on Windows",
      createdAt: "2026-08-14T08:00:00.000Z",
      lastUsedAt: "2026-08-14T09:30:00.000Z",
      expiresAt: "2026-09-13T08:00:00.000Z",
      current: true,
    },
    {
      id: "session-phone",
      userAgent: "Safari on iPhone",
      createdAt: "2026-08-13T08:00:00.000Z",
      lastUsedAt: "2026-08-13T10:00:00.000Z",
      expiresAt: "2026-09-12T08:00:00.000Z",
      current: false,
    },
    {
      id: "session-edge",
      userAgent: "Edge on Windows",
      createdAt: "2026-08-12T08:00:00.000Z",
      lastUsedAt: "2026-08-12T11:00:00.000Z",
      expiresAt: "2026-09-11T08:00:00.000Z",
      current: false,
    },
  ],
  deletionRequest: null,
  appeals: [
    {
      id: "appeal-old",
      reason: "希望重新检查资料审核结果",
      evidence: [],
      status: "resolved",
      resolution: "资料已重新审核",
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-11T08:00:00.000Z",
    },
  ],
  dataExports: [],
};

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="当前地址">{`${location.pathname}${location.search}`}</output>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createApi(overrides: Partial<AccountSecurityApi> = {}): AccountSecurityApi {
  return {
    load: vi.fn(async () => initialData),
    updateVisibility: vi.fn(async (visibility) => ({ visibility })),
    revokeSession: vi.fn(async () => undefined),
    revokeOtherSessions: vi.fn(async () => undefined),
    suspendAccount: vi.fn(async () => undefined),
    requestDeletion: vi.fn(async () => ({
      requestedAt: "2026-08-14T10:00:00.000Z",
      scheduledAt: "2026-08-21T10:00:00.000Z",
    })),
    cancelDeletion: vi.fn(async () => undefined),
    submitAppeal: vi.fn(async ({ reason, evidence }) => ({
      id: "appeal-new",
      reason,
      evidence,
      status: "pending" as const,
      resolution: null,
      createdAt: "2026-08-14T10:00:00.000Z",
      updatedAt: "2026-08-14T10:00:00.000Z",
    })),
    requestDataExport: vi.fn(async () => ({
      id: "export-new",
      status: "ready" as const,
      createdAt: "2026-08-14T10:00:00.000Z",
      readyAt: "2026-08-14T10:00:00.000Z",
      expiresAt: "2026-08-15T10:00:00.000Z",
    })),
    downloadDataExport: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(cleanup);

describe("账号与安全中心", () => {
  it("放入应用外壳后只保留一个主要内容区域", async () => {
    render(<main data-testid="app-main"><AccountSecurityPage api={createApi()} /></main>);

    await screen.findByRole("heading", { name: "账号与安全" });

    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("加载账号数据并保存资料可见性", async () => {
    const api = createApi();
    const user = userEvent.setup();
    render(<AccountSecurityPage api={api} />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取账号安全信息");
    expect(await screen.findByRole("heading", { name: "账号与安全" })).toBeVisible();
    expect(screen.getByText("Chrome on Windows")).toBeVisible();

    await user.click(screen.getByRole("radio", { name: /仅自己可见/ }));
    await user.click(screen.getByRole("button", { name: "保存可见范围" }));

    await waitFor(() => expect(api.updateVisibility).toHaveBeenCalledWith("private"));
    expect(screen.getByRole("status")).toHaveTextContent("资料可见范围已保存");
  });

  it("加载失败时说明原因并允许重新加载", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("网络连接中断"))
      .mockResolvedValueOnce(initialData);
    const api = createApi({ load });
    const user = userEvent.setup();
    render(<AccountSecurityPage api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接中断");
    await user.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("heading", { name: "账号与安全" })).toBeVisible();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("管理员停用账号时明确提示受限状态并只保留申诉能力", async () => {
    const api = createApi({
      load: vi.fn(async () => ({
        ...initialData,
        accountStatus: "suspended" as const,
        suspensionSource: "admin" as const,
      })),
    });
    render(<AccountSecurityPage api={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("账号已被管理员停用");
    expect(screen.getByRole("button", { name: "保存可见范围" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成数据文件" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交申诉" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "停用账号" })).not.toBeInTheDocument();
  });

  it("可撤销指定设备或一键退出其他设备", async () => {
    const api = createApi();
    const user = userEvent.setup();
    render(<AccountSecurityPage api={api} />);
    await screen.findByRole("heading", { name: "登录设备" });

    const phoneSession = screen.getByText("Safari on iPhone").closest("li");
    expect(phoneSession).not.toBeNull();
    await user.click(within(phoneSession!).getByRole("button", { name: "退出此设备" }));
    await waitFor(() => expect(api.revokeSession).toHaveBeenCalledWith("session-phone"));
    expect(screen.queryByText("Safari on iPhone")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "退出其他设备" }));
    await waitFor(() => expect(api.revokeOtherSessions).toHaveBeenCalledOnce());
    expect(screen.getByText("已退出其他设备，只保留当前设备。" )).toBeVisible();
    expect(screen.queryByText("Edge on Windows")).not.toBeInTheDocument();
  });

  it("停用账号后清理本地摘要并跳转登录页", async () => {
    const api = createApi();
    const user = userEvent.setup();
    localStorage.setItem("ai-marriage-auth-user", "saved-account");
    sessionStorage.setItem("ai-marriage-auth-profile", "saved-profile");
    render(
      <MemoryRouter initialEntries={["/me/security"]}>
        <Routes>
          <Route path="/me/security" element={<AccountSecurityPage api={api} />} />
          <Route path="/auth" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "账号状态" });

    await user.click(screen.getByRole("button", { name: "停用账号" }));
    const dialog = screen.getByRole("dialog", { name: "确认停用账号" });
    await user.type(within(dialog).getByRole("textbox", { name: "停用原因（选填）" }), "暂时离开一段时间");
    await user.click(within(dialog).getByRole("button", { name: "确认停用并退出" }));

    await waitFor(() => expect(api.suspendAccount).toHaveBeenCalledWith("暂时离开一段时间"));
    expect(localStorage.getItem("ai-marriage-auth-user")).toBeNull();
    expect(sessionStorage.getItem("ai-marriage-auth-profile")).toBeNull();
    expect(await screen.findByLabelText("当前地址")).toHaveTextContent("/auth");
  });

  it("打开确认弹窗后移动焦点并可用 Escape 返回触发按钮", async () => {
    const user = userEvent.setup();
    render(<AccountSecurityPage api={createApi()} />);
    await screen.findByRole("heading", { name: "账号状态" });

    const opener = screen.getByRole("button", { name: "停用账号" });
    await user.click(opener);

    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "确认停用账号" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("申请注销后显示冷静期并可取消", async () => {
    const api = createApi();
    const user = userEvent.setup();
    render(<AccountSecurityPage api={api} />);
    await screen.findByRole("heading", { name: "账号状态" });

    await user.click(screen.getByRole("button", { name: "申请注销" }));
    const dialog = screen.getByRole("dialog", { name: "确认申请注销" });
    await user.click(within(dialog).getByRole("checkbox", { name: /我已了解账号将在冷静期结束后注销/ }));
    await user.click(within(dialog).getByRole("button", { name: "确认申请注销" }));

    expect(await screen.findByText(/注销冷静期至/)).toBeVisible();
    expect(api.requestDeletion).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "取消注销" }));
    await waitFor(() => expect(api.cancelDeletion).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "申请注销" })).toBeVisible();
  });

  it("校验申诉内容并把新申诉加入记录", async () => {
    const api = createApi();
    const user = userEvent.setup();
    render(<AccountSecurityPage api={api} />);
    await screen.findByRole("heading", { name: "账号申诉" });

    await user.type(screen.getByRole("textbox", { name: "申诉原因" }), "太短");
    await user.click(screen.getByRole("button", { name: "提交申诉" }));
    expect(screen.getByRole("alert")).toHaveTextContent("至少填写 5 个字");
    expect(api.submitAppeal).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("textbox", { name: "申诉原因" }));
    await user.type(screen.getByRole("textbox", { name: "申诉原因" }), "希望重新复核我的账号资料");
    await user.type(screen.getByRole("textbox", { name: "补充说明（选填）" }), "资料均由本人填写\n可以配合补充材料");
    await user.click(screen.getByRole("button", { name: "提交申诉" }));

    await waitFor(() => expect(api.submitAppeal).toHaveBeenCalledWith({
      reason: "希望重新复核我的账号资料",
      evidence: ["资料均由本人填写", "可以配合补充材料"],
    }));
    expect(await screen.findByText("等待处理")).toBeVisible();
  });

  it("生成个人数据文件后提供下载入口", async () => {
    const api = createApi();
    const user = userEvent.setup();
    render(<AccountSecurityPage api={api} />);
    await screen.findByRole("heading", { name: "个人数据导出" });

    await user.click(screen.getByRole("button", { name: "生成数据文件" }));
    expect(await screen.findByRole("button", { name: "下载数据文件" })).toBeVisible();
    expect(api.requestDataExport).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "下载数据文件" }));
    await waitFor(() => expect(api.downloadDataExport).toHaveBeenCalledWith("export-new"));
  });
});
