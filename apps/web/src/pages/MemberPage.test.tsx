import "@testing-library/jest-dom/vitest";
import type { Member } from "@ai-marriage/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, blockUser, createInterest, createReport, getInterests, getMe, getMember } from "../api/client";
import { MemberPage } from "./MemberPage";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, getMember: vi.fn(), getMe: vi.fn(), getInterests: vi.fn(), createInterest: vi.fn(), createReport: vi.fn(), blockUser: vi.fn() };
});

const auditedMember: Member = {
  id: "member-zhou",
  userId: "user-zhou",
  nickname: "周明远",
  gender: "男性",
  age: 49,
  city: "上海",
  district: "徐汇",
  job: "建筑设计",
  maritalStatus: "离异",
  goal: "以结婚为目标",
  tags: ["喜欢徒步", "作息规律"],
  introduction: "希望认真了解彼此，也愿意慢慢建立信任。",
  photoUrl: "https://example.com/zhou.jpg",
  activeLabel: "最近活跃",
  verified: true,
};

function renderPage(entry = "/member/member-zhou") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="/member/:memberId" element={<MemberPage />} /></Routes>
    </MemoryRouter>,
  );
}

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="当前地址">{`${location.pathname}${location.search}`}</output>;
}

const completeAccount = {
  user: { id: "user-me", phoneMasked: "138****0000", role: "user" as const, status: "active" as const },
  profile: { userId: "user-me", nickname: "我", gender: "男性", birthYear: 1978, city: "上海", district: "浦东", job: "工程", maritalStatus: "离异", goal: "认真交往", introduction: "认真认识。", preference: {}, answers: {}, profileStatus: "approved" as const, updatedAt: "2026-08-14T08:00:00.000Z" },
};

describe("会员详情", () => {
  beforeEach(() => {
    vi.mocked(getMember).mockReset();
    vi.mocked(getMe).mockReset();
    vi.mocked(getMe).mockResolvedValue({ ...completeAccount, profile: null });
    vi.mocked(getInterests).mockReset();
    vi.mocked(getInterests).mockResolvedValue({ sent: [], received: [], mutual: [] });
    vi.mocked(createInterest).mockReset();
    vi.mocked(createReport).mockReset();
    vi.mocked(blockUser).mockReset();
  });
  afterEach(cleanup);

  it("加载期间显示提示，并按路由会员编号读取 API", () => {
    vi.mocked(getMember).mockReturnValue(new Promise(() => undefined));

    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("正在加载会员资料");
    expect(getMember).toHaveBeenCalledWith("member-zhou");
  });

  it("展示 API 返回的真实审核资料且不回退到静态人物", async () => {
    vi.mocked(getMember).mockResolvedValue({ member: auditedMember });

    renderPage();

    expect(await screen.findByRole("heading", { name: "周明远，49 岁" })).toBeVisible();
    expect(screen.getByText("上海 · 徐汇 · 建筑设计")).toBeVisible();
    expect(screen.getByText("离异")).toBeVisible();
    expect(screen.getByText("以结婚为目标")).toBeVisible();
    expect(screen.getByText("希望认真了解彼此，也愿意慢慢建立信任。")).toBeVisible();
    expect(screen.getByText("资料已审核")).toBeVisible();
    expect(screen.queryByText("演示资料")).not.toBeInTheDocument();
  });

  it("在会员资料中提供语音介绍预览，帮助更真实地了解对方", async () => {
    const user = userEvent.setup();
    vi.mocked(getMember).mockResolvedValue({
      member: {
        ...auditedMember,
        voiceIntroUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10",
        voiceIntroTranscript: "我喜欢慢慢了解，一起周末散步、做饭和看展。",
      },
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "周明远，49 岁" })).toBeVisible();
    expect(screen.getByRole("button", { name: "播放语音介绍" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看文字版" }));
    expect(screen.getByText("我喜欢慢慢了解，一起周末散步、做饭和看展。")).toBeVisible();
  });

  it("展示生活方式和相处方式，让别人更容易感受到真实的人", async () => {
    vi.mocked(getMember).mockResolvedValue({
      member: {
        ...auditedMember,
        lifeStory: "我喜欢稳定和慢慢建立信任，周末常做饭和散步，也希望对方愿意彼此尊重。",
        lifeHighlights: ["喜欢做饭与散步", "重视稳定关系", "愿意慢慢建立信任"],
      },
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "周明远，49 岁" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "生活方式" })).toBeVisible();
    expect(screen.getByText("我喜欢稳定和慢慢建立信任，周末常做饭和散步，也希望对方愿意彼此尊重。" )).toBeVisible();
    expect(screen.getByText("喜欢做饭与散步")).toBeVisible();
  });

  it("可以用明确按钮和缩略图浏览会员的多张审核照片", async () => {
    const user = userEvent.setup();
    vi.mocked(getMember).mockResolvedValue({ member: {
      ...auditedMember,
      photoUrls: [
        "https://example.com/zhou.jpg",
        "https://example.com/zhou-life.jpg",
        "https://example.com/zhou-hiking.jpg",
      ],
    } });

    renderPage();

    const mainPhoto = await screen.findByAltText("周明远的照片，第 1 张");
    expect(mainPhoto).toHaveAttribute("src", "https://example.com/zhou.jpg");
    expect(screen.getByText("第 1 张，共 3 张")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "下一张照片" }));
    expect(screen.getByAltText("周明远的照片，第 2 张")).toHaveAttribute("src", "https://example.com/zhou-life.jpg");
    await user.click(screen.getByRole("button", { name: "查看第 3 张照片" }));
    expect(screen.getByAltText("周明远的照片，第 3 张")).toHaveAttribute("src", "https://example.com/zhou-hiking.jpg");
    await user.click(screen.getByRole("button", { name: "上一张照片" }));
    expect(screen.getByAltText("周明远的照片，第 2 张")).toBeVisible();
  });

  it("API 失败时显示原因和返回匹配大厅入口", async () => {
    vi.mocked(getMember).mockRejectedValue(new Error("暂时找不到这位用户。"));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时找不到这位用户");
    expect(screen.getByRole("link", { name: "返回匹配大厅" })).toHaveAttribute("href", "/find");
  });

  it("从建档返回后显示已记录感兴趣状态", async () => {
    vi.mocked(getMember).mockResolvedValue({ member: auditedMember });

    renderPage("/member/member-zhou?favorited=1");

    expect(await screen.findByText(/已记录感兴趣/)).toHaveAttribute("role", "status");
  });

  it("可以提交真实举报并屏蔽会员", async () => {
    const user = userEvent.setup();
    vi.mocked(getMember).mockResolvedValue({ member: auditedMember });
    vi.mocked(createReport).mockResolvedValue({ report: { id: "report-1" } } as never);
    vi.mocked(blockUser).mockResolvedValue({ block: { id: "block-1" } } as never);
    renderPage();

    await user.click(await screen.findByRole("button", { name: "举报此用户" }));
    await user.type(screen.getByLabelText("举报情况说明"), "个人资料与聊天内容明显不一致");
    await user.click(screen.getByRole("button", { name: "提交举报" }));
    expect(createReport).toHaveBeenCalledWith({ targetUserId: "user-zhou", reason: "资料虚假", description: "个人资料与聊天内容明显不一致" });
    expect(await screen.findByRole("status")).toHaveTextContent("举报已提交");

    await user.click(screen.getByRole("button", { name: "屏蔽此用户" }));
    await user.click(screen.getByRole("button", { name: "确认屏蔽" }));
    expect(blockUser).toHaveBeenCalledWith("user-zhou");
    expect(await screen.findByRole("status")).toHaveTextContent("已屏蔽此用户");
  });

  it("已有档案时直接记录感兴趣，不再跳转建档", async () => {
    const user = userEvent.setup();
    vi.mocked(getMember).mockResolvedValue({ member: auditedMember });
    vi.mocked(getMe).mockResolvedValue(completeAccount);
    vi.mocked(createInterest).mockResolvedValue({ interest: { id: "interest-1", memberId: auditedMember.id } });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "感兴趣" }));

    expect(createInterest).toHaveBeenCalledWith("member-zhou");
    expect(await screen.findByRole("status")).toHaveTextContent("已记录感兴趣");
    expect(screen.queryByRole("link", { name: "感兴趣" })).not.toBeInTheDocument();
  });

  it("读取真实心仪状态，已心仪时直接进入 AI 分身聊天", async () => {
    vi.mocked(getMember).mockResolvedValue({ member: auditedMember });
    vi.mocked(getMe).mockResolvedValue(completeAccount);
    vi.mocked(getInterests).mockResolvedValue({
      sent: [{ id: "interest-1", userId: "user-me", memberId: auditedMember.id, status: "active", createdAt: "2026-08-14T08:00:00.000Z", updatedAt: "2026-08-14T08:00:00.000Z", member: auditedMember }],
      received: [],
      mutual: [],
    });
    renderPage();

    expect(await screen.findByRole("button", { name: "已感兴趣" })).toBeDisabled();
    expect(await screen.findByRole("link", { name: /和 TA 的 AI 分身聊聊/ })).toHaveAttribute("href", "/matchmaking/member-zhou/chat");
    expect(getInterests).toHaveBeenCalledOnce();
  });

  it("未心仪时可以先设为心仪并继续进入 AI 分身聊天", async () => {
    const user = userEvent.setup();
    vi.mocked(getMember).mockResolvedValue({ member: auditedMember });
    vi.mocked(getMe).mockResolvedValue(completeAccount);
    vi.mocked(createInterest).mockResolvedValue({ interest: { id: "interest-1", memberId: auditedMember.id } });
    render(
      <MemoryRouter initialEntries={["/member/member-zhou"]}>
        <Routes>
          <Route path="/member/:memberId" element={<MemberPage />} />
          <Route path="/matchmaking/:memberId/chat" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "先设为心仪，再聊 AI 分身" }));

    expect(createInterest).toHaveBeenCalledWith("member-zhou");
    expect(await screen.findByLabelText("当前地址")).toHaveTextContent("/matchmaking/member-zhou/chat");
  });

  it("账号接口网络失败时显示重试，不误导已有用户重新建档", async () => {
    const user = userEvent.setup();
    vi.mocked(getMember).mockResolvedValue({ member: auditedMember });
    vi.mocked(getMe)
      .mockRejectedValueOnce(new ApiError("账号服务暂时不可用", "INTERNAL_ERROR", 500))
      .mockResolvedValueOnce(completeAccount);
    renderPage();

    expect(await screen.findByRole("alert", { name: "账号状态读取失败" })).toHaveTextContent("账号服务暂时不可用");
    expect(screen.queryByRole("link", { name: "感兴趣" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /和 TA 的 AI 分身聊聊/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新检查账号" }));

    expect(await screen.findByRole("button", { name: "先设为心仪，再聊 AI 分身" })).toBeVisible();
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it("没有档案时把联系操作引导到建档，并保留目标", async () => {
    vi.mocked(getMember).mockResolvedValue({ member: auditedMember });
    vi.mocked(getMe).mockResolvedValue({ ...completeAccount, profile: null });
    render(
      <MemoryRouter initialEntries={["/member/member-zhou"]}>
        <Routes>
          <Route path="/member/:memberId" element={<MemberPage />} />
          <Route path="/onboarding" element={<CurrentLocation />} />
        </Routes>
      </MemoryRouter>,
    );

    const favorite = await screen.findByRole("link", { name: "感兴趣" });
    expect(favorite).toHaveAttribute("href", "/onboarding?next=%2Fmember%2Fmember-zhou&intent=favorite&member=member-zhou");
    expect(screen.getByRole("link", { name: /和 TA 的 AI 分身聊聊/ })).toHaveAttribute("href", "/onboarding?next=%2Fmatchmaking%2Fmember-zhou%2Fchat&member=member-zhou");
  });
});
