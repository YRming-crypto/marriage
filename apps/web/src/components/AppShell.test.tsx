import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

function renderShell(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <h1>首页</h1> },
          { path: "/messages", element: <h1>消息</h1> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );

  return { router, ...render(<RouterProvider router={router} />) };
}

describe("页面标题", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "请先登录。" } }), { status: 401, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("scrollTo", vi.fn());
    document.title = "缘来相伴｜认真认识，安心交往";
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("根据当前页面显示便于识别的浏览器标题", async () => {
    renderShell("/messages");

    await waitFor(() => expect(document.title).toBe("消息｜缘来相伴"));
  });
});
