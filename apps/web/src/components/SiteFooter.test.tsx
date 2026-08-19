import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SiteFooter } from "./SiteFooter";

describe("网站页脚", () => {
  afterEach(cleanup);

  it("链接到独立的用户协议和隐私政策页面", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "用户协议" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "隐私政策" })).toHaveAttribute("href", "/privacy");
  });

  it("区分预置演示资料与注册用户真实建档", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );

    expect(screen.getByText("预置资料会标注为演示资料，注册用户数据来自本人建档。")).toBeInTheDocument();
    expect(screen.queryByText("本网站当前为产品开发演示，人物资料与内容均为演示数据。")).not.toBeInTheDocument();
  });
});
