import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  Link,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { MotionEnhancer } from "./MotionEnhancer";

function renderShell(routes = [{ path: "/", label: "首页内容" }]) {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: routes.map(({ path, label }) => ({
          path,
          element: <section data-reveal>{label}</section>,
        })),
      },
    ],
    { initialEntries: [routes[0].path] },
  );

  return { router, ...render(<RouterProvider router={router} />) };
}

function stubIntersectionObserver() {
  const instances: Array<{
    callback: IntersectionObserverCallback;
    observer: IntersectionObserver;
  }> = [];
  const Observer = vi.fn((nextCallback: IntersectionObserverCallback) => {
    const observer = {
      disconnect: vi.fn(),
      observe: vi.fn(),
      root: null,
      rootMargin: "0px",
      takeRecords: vi.fn(() => []),
      thresholds: [],
      unobserve: vi.fn(),
    } as unknown as IntersectionObserver;

    instances.push({ callback: nextCallback, observer });
    return observer;
  });

  vi.stubGlobal("IntersectionObserver", Observer);

  return {
    instances,
    enter(target: Element, instanceIndex = 0) {
      const instance = instances[instanceIndex];
      if (!instance) {
        throw new Error("IntersectionObserver 尚未创建");
      }

      act(() => {
        instance.callback(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          instance.observer,
        );
      });
    },
  };
}

describe("MotionEnhancer", () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("IntersectionObserver 不可用时立即显示待进入内容", () => {
    vi.stubGlobal("IntersectionObserver", undefined);

    renderShell();

    expect(screen.getByText("首页内容")).toHaveClass("is-revealed");
  });

  it("观察待进入内容，并在进入视口后显示且取消观察", () => {
    const intersectionObserver = stubIntersectionObserver();

    renderShell();
    const revealElement = screen.getByText("首页内容");
    const { observer } = intersectionObserver.instances[0];

    expect(observer.observe).toHaveBeenCalledWith(revealElement);
    expect(revealElement).not.toHaveClass("is-revealed");

    intersectionObserver.enter(revealElement);

    expect(revealElement).toHaveClass("is-revealed");
    expect(observer.unobserve).toHaveBeenCalledWith(revealElement);
  });

  it("路由变化时断开旧观察器，组件卸载时断开当前观察器", async () => {
    const intersectionObserver = stubIntersectionObserver();
    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <MotionEnhancer>
          <Link to="/next">前往下一页</Link>
          <Routes>
            <Route path="/" element={<section data-reveal>首页内容</section>} />
            <Route path="/next" element={<section data-reveal>下一页内容</section>} />
          </Routes>
        </MotionEnhancer>
      </MemoryRouter>,
    );
    const firstObserver = intersectionObserver.instances[0].observer;

    fireEvent.click(screen.getByRole("link", { name: "前往下一页" }));

    expect(firstObserver.disconnect).toHaveBeenCalledOnce();
    const secondObserver = intersectionObserver.instances[1].observer;
    expect(secondObserver.observe).toHaveBeenCalledWith(screen.getByText("下一页内容"));

    unmount();

    expect(secondObserver.disconnect).toHaveBeenCalledOnce();
  });
});
