import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getMySoulTest, getSoulTestQuestions } from "../api/client";
import { SoulTestPage } from "./SoulTestPage";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getSoulTestQuestions: vi.fn(),
    getMySoulTest: vi.fn(),
    submitSoulTest: vi.fn(),
  };
});

describe("性格缘分页", () => {
  beforeEach(() => {
    vi.mocked(getSoulTestQuestions).mockReset();
    vi.mocked(getMySoulTest).mockReset();
  });

  it("即使我的测试状态接口要求登录，也仍然能加载题目并显示模式选择", async () => {
    vi.mocked(getSoulTestQuestions).mockResolvedValue({
      questions: [{
        id: "q-1",
        dimension: "social",
        dimensionLabel: "社交倾向",
        text: "你更喜欢哪种社交场景？",
        optionA: { label: "热闹聚会，和大家一起聊", value: 2 },
        optionB: { label: "安静独处，慢慢了解一个人", value: 1 },
      }],
      totalCount: 1,
    });
    vi.mocked(getMySoulTest).mockRejectedValue(new ApiError("请先登录。", "AUTH_REQUIRED", 401));

    render(
      <MemoryRouter>
        <SoulTestPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "探索你的性格画像" })).toBeVisible();
    expect(screen.getByText("答题测试")).toBeVisible();
    expect(screen.getByText("AI 语音聊天")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "无法加载测试" })).not.toBeInTheDocument();
  });

  it("点击答题测试后显示题目", async () => {
    vi.mocked(getSoulTestQuestions).mockResolvedValue({
      questions: [{
        id: "q-1",
        dimension: "social",
        dimensionLabel: "社交倾向",
        text: "你更喜欢哪种社交场景？",
        optionA: { label: "热闹聚会，和大家一起聊", value: 2 },
        optionB: { label: "安静独处，慢慢了解一个人", value: 1 },
      }],
      totalCount: 1,
    });
    vi.mocked(getMySoulTest).mockRejectedValue(new ApiError("请先登录。", "AUTH_REQUIRED", 401));

    render(
      <MemoryRouter>
        <SoulTestPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "探索你的性格画像" })).toBeVisible();

    // Click the quiz mode card
    const quizText = screen.getAllByText("答题测试", { selector: "strong" })[0];
    const quizButton = quizText.closest("button")!;
    fireEvent.click(quizButton);

    // Now the question should be visible
    expect(await screen.findByText("你更喜欢哪种社交场景？")).toBeVisible();
  });
});
