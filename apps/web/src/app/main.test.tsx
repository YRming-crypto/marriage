import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const rootRender = vi.hoisted(() => vi.fn());

vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: rootRender }),
}));

vi.mock("./router", () => ({ router: {} }));

vi.mock("react-router-dom", () => ({
  RouterProvider: () => {
    throw new Error("测试中的页面渲染失败");
  },
}));

await import("../main");

function componentName(node: ReactNode) {
  if (!node || typeof node !== "object" || !("type" in node)) return "";
  const type = (node as ReactElement).type;
  if (typeof type === "string") return type;
  const namedType = type as { displayName?: string; name?: string };
  return namedType.displayName ?? namedType.name ?? "";
}

describe("应用入口错误边界", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeAll(() => {
    consoleError.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  it("在 RouterProvider 外层接入全局错误边界", () => {
    const strictModeTree = rootRender.mock.calls[0]?.[0] as ReactElement<{ children: ReactNode }>;
    const appTree = strictModeTree.props.children;

    expect(componentName(appTree)).toBe("GlobalErrorBoundary");
  });

  it("页面渲染失败时显示刷新与返回首页操作", () => {
    const appTree = rootRender.mock.calls[0]?.[0] as ReactElement;

    try {
      render(appTree);
    } catch {
      // 测试先于错误边界实现时，React 会把渲染错误抛给调用方。
    }

    expect(screen.getByRole("heading", { name: "页面出了点问题" })).toBeVisible();
    expect(screen.getByRole("button", { name: "刷新页面" })).toBeVisible();
    expect(screen.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/");
  });
});
