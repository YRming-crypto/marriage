import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("生产网关可信代理边界", () => {
  it("共享包的默认运行时入口指向编译产物", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "packages/shared/package.json"), "utf8")) as {
      exports?: { "."?: { default?: string } };
    };

    expect(packageJson.exports?.["."]?.default).toBe("./dist/index.js");
  });

  it("要求显式配置可信 TLS 代理网段", () => {
    const compose = readFileSync(resolve(root, "deploy/docker-compose.yml"), "utf8");
    const environment = readFileSync(resolve(root, "deploy/.env.example"), "utf8");

    expect(compose).toContain("TRUSTED_PROXY_CIDR: ${TRUSTED_PROXY_CIDR:?");
    expect(environment).toContain("TRUSTED_PROXY_CIDR=127.0.0.1/32");
  });

  it("只接受可信代理提供的 X-Forwarded-For", () => {
    const nginx = readFileSync(resolve(root, "deploy/gateway/nginx.conf"), "utf8");
    const entrypoint = readFileSync(resolve(root, "deploy/gateway/entrypoint.sh"), "utf8");

    expect(nginx).toContain("set_real_ip_from __TRUSTED_PROXY_CIDR__;");
    expect(nginx).toContain("real_ip_header X-Forwarded-For;");
    expect(nginx).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(entrypoint).toContain("TRUSTED_PROXY_CIDR must be a single IPv4 or IPv6 CIDR.");
  });
});
