import { describe, expect, it } from "vitest";
import { mainNavigation } from "./navigation";

describe("主导航", () => {
  it("按照产品规格提供十个普通用户入口，并把匹配大厅作为独立栏目", () => {
    expect(mainNavigation.map((item) => item.label)).toEqual([
      "首页",
      "匹配大厅",
      "灵魂测试",
      "消息",
      "话题广场",
      "动态",
      "线下活动",
      "幸福案例",
      "婚恋课堂",
      "我的",
    ]);
  });

  it("不在普通导航中公开后台或算法入口", () => {
    expect(mainNavigation.some((item) => /后台|算法|权重|问答/.test(item.label))).toBe(false);
  });
});
