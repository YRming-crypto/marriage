import type {
  ComponentHealthResult,
  ComponentHealthSnapshot,
  HealthCheck,
  HealthReport,
  HealthStatus,
} from "./types.js";

export interface HealthRegistryOptions {
  now?: () => number;
}
export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();
  private readonly now: () => number;

  constructor(options: HealthRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  register(name: string, check: HealthCheck) {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new TypeError("健康检查组件名不能为空");
    }
    if (typeof check !== "function") {
      throw new TypeError("健康检查必须是函数");
    }
    this.checks.set(normalizedName, check);
  }

  unregister(name: string) {
    return this.checks.delete(name.trim());
  }

  async checkAll(): Promise<HealthReport> {
    const components = await Promise.all(
      [...this.checks.entries()].map(async ([name, check]): Promise<ComponentHealthSnapshot> => {
        try {
          const result = await check();
          validateResult(result);
          return result.detail === undefined
            ? { name, status: result.status }
            : { name, status: result.status, detail: result.detail };
        } catch {
          return { name, status: "unhealthy", detail: "检查失败" };
        }
      }),
    );
    components.sort((left, right) => left.name.localeCompare(right.name));
    return {
      status: aggregateStatus(components),
      checkedAt: this.now(),
      components,
    };
  }
}

function validateResult(result: ComponentHealthResult) {
  if (!result || !["healthy", "degraded", "unhealthy"].includes(result.status)) {
    throw new TypeError("健康检查返回了无效状态");
  }
  if (result.detail !== undefined && typeof result.detail !== "string") {
    throw new TypeError("健康检查详情必须是字符串");
  }
}

function aggregateStatus(components: ComponentHealthSnapshot[]): HealthStatus {
  if (components.some((component) => component.status === "unhealthy")) {
    return "unhealthy";
  }
  if (components.some((component) => component.status === "degraded")) {
    return "degraded";
  }
  return "healthy";
}
