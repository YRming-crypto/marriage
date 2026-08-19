import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMembers, requestOtp, verifyOtp } from "../api/client";
import { useOtpAccount } from "./useOtpAccount";

const connectionErrorMessage = "账号服务暂时无法连接，请确认本地 API 已启动后重试。";
const generalConnectionErrorMessage = "服务暂时无法连接，请稍后重试。";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function responseWithJson(body: unknown) {
  return {
    ok: true,
    json: vi.fn(async () => body),
  } as unknown as Response;
}

function setAccountInput(
  result: ReturnType<typeof renderHook<ReturnType<typeof useOtpAccount>, unknown>>["result"],
  values: { phone?: string; code?: string; agreed?: boolean },
) {
  act(() => {
    if (values.phone !== undefined) result.current.setPhone(values.phone);
    if (values.code !== undefined) result.current.setCode(values.code);
    if (values.agreed !== undefined) result.current.setAgreed(values.agreed);
  });
}

describe("useOtpAccount", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("手机号号段非法时不发送请求", async () => {
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "12800138000", agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.message).toBe("请输入正确的11位手机号。");
  });

  it("未同意协议时既不发送验证码也不验证账号", async () => {
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", code: "123456" });

    await act(async () => {
      await result.current.sendCode();
      await result.current.verifyAccount();
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.message).toBe("请先阅读并同意用户协议和隐私政策。");
  });

  it("发送成功后显示本地验证码及换算后的有效分钟数", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: { sent: true, expiresIn: 300, devCode: "123456" },
    }));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });

    expect(result.current.message).toBe("本地演示验证码：123456，有效期 5 分钟。");
    expect(result.current.secondsUntilResend).toBe(60);
    expect(result.current.busy).toBe(false);
  });

  it("没有本地验证码时提示查收短信", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: { sent: true, expiresIn: 300 },
    }));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });

    expect(result.current.message).toBe("验证码已发送，请查收短信。");
  });

  it("60 秒倒计时结束前禁止重复发送，结束后可以再次发送", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      data: { sent: true, expiresIn: 300, devCode: "123456" },
    }));
    const { result, unmount } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });
    await act(async () => {
      await result.current.sendCode();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.secondsUntilResend).toBe(59);

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current.secondsUntilResend).toBe(0);

    await act(async () => {
      await result.current.sendCode();
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("发送成功后输入验证码不会清除重发倒计时", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: { sent: true, expiresIn: 300, devCode: "123456" },
    }));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });
    setAccountInput(result, { code: "123456" });

    expect(result.current.secondsUntilResend).toBe(60);
    await act(async () => {
      await result.current.sendCode();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("发送等待期间自动填入验证码不会取消响应且仍禁止重复发送", async () => {
    const pendingResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingResponse.promise);
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    let sendResult: Awaited<ReturnType<typeof requestOtp>> | undefined;
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.sendCode().then((value) => {
        sendResult = value;
      });
    });
    setAccountInput(result, { code: "123456" });

    expect(result.current.busy).toBe(true);
    await act(async () => {
      await result.current.sendCode();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingResponse.resolve(jsonResponse({
        data: { sent: true, expiresIn: 300, devCode: "123456" },
      }));
      await sendPromise;
    });

    expect(sendResult).toEqual({ sent: true, expiresIn: 300, devCode: "123456" });
    expect(result.current.message).toBe("本地演示验证码：123456，有效期 5 分钟。");
    expect(result.current.secondsUntilResend).toBe(60);
    expect(result.current.busy).toBe(false);
  });

  it("发送等待期间取消协议会忽略旧响应", async () => {
    const pendingResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingResponse.promise);
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    let sendResult: Awaited<ReturnType<typeof requestOtp>> | undefined;
    const sendPromise = result.current.sendCode().then((value) => {
      sendResult = value;
    });
    setAccountInput(result, { agreed: false });

    await act(async () => {
      pendingResponse.resolve(jsonResponse({
        data: { sent: true, expiresIn: 300, devCode: "123456" },
      }));
      await sendPromise;
    });

    expect(sendResult).toBeUndefined();
    expect(result.current.message).toBe("");
    expect(result.current.secondsUntilResend).toBe(0);
    expect(result.current.isVerified).toBe(false);
  });

  it("发送等待期间取消后重新同意仍要等旧请求结束", async () => {
    const pendingResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingResponse.promise);
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    let firstPromise!: Promise<unknown>;
    act(() => {
      firstPromise = result.current.sendCode();
    });
    setAccountInput(result, { agreed: false });
    setAccountInput(result, { agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);

    await act(async () => {
      pendingResponse.resolve(jsonResponse({
        data: { sent: true, expiresIn: 300, devCode: "123456" },
      }));
      await firstPromise;
    });

    expect(result.current.busy).toBe(false);
    expect(result.current.message).toBe("");
    expect(result.current.secondsUntilResend).toBe(0);
  });

  it("更换手机号清除旧手机号的验证码提示和倒计时", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: { sent: true, expiresIn: 300, devCode: "123456" },
    }));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });
    setAccountInput(result, { phone: "13900139000" });

    expect(result.current.message).toBe("");
    expect(result.current.secondsUntilResend).toBe(0);
    expect(result.current.isVerified).toBe(false);
  });

  it("验证码验证成功后返回结果并更新验证状态", async () => {
    const verifiedAccount: {
      user: { id: string; phoneMasked: string };
      profile: Record<string, unknown> | null;
    } = {
      user: { id: "user-1", phoneMasked: "138****8000" },
      profile: null,
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: verifiedAccount }));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", code: "123456", agreed: true });

    let accountResult: typeof verifiedAccount | undefined;
    await act(async () => {
      accountResult = await result.current.verifyAccount();
    });

    expect(accountResult).toEqual(verifiedAccount);
    expect(result.current.isVerified).toBe(true);
    expect(result.current.message).toBe("账号验证成功。");
  });

  it("普通输入验证码保留已发送提示，验证成功后再改验证码会清除成功提示", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        data: { sent: true, expiresIn: 300, devCode: "123456" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: { id: "user-1", phoneMasked: "138****8000" },
          profile: null,
        },
      }));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });
    setAccountInput(result, { code: "123456" });
    expect(result.current.message).toBe("本地演示验证码：123456，有效期 5 分钟。");

    await act(async () => {
      await result.current.verifyAccount();
    });
    expect(result.current.isVerified).toBe(true);
    expect(result.current.message).toBe("账号验证成功。");

    setAccountInput(result, { code: "654321" });
    expect(result.current.isVerified).toBe(false);
    expect(result.current.message).toBe("");
    expect(result.current.secondsUntilResend).toBe(60);
  });

  it("取消协议会清除验证成功状态和提示", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      data: {
        user: { id: "user-1", phoneMasked: "138****8000" },
        profile: null,
      },
    }));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", code: "123456", agreed: true });

    await act(async () => {
      await result.current.verifyAccount();
    });
    setAccountInput(result, { agreed: false });

    expect(result.current.isVerified).toBe(false);
    expect(result.current.message).toBe("");
  });

  it("验证等待期间取消协议会忽略旧成功响应", async () => {
    const pendingResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingResponse.promise);
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", code: "123456", agreed: true });

    let verifyResult: Awaited<ReturnType<typeof verifyOtp>> | undefined;
    const verifyPromise = result.current.verifyAccount().then((value) => {
      verifyResult = value;
    });
    setAccountInput(result, { agreed: false });

    await act(async () => {
      pendingResponse.resolve(jsonResponse({
        data: {
          user: { id: "user-1", phoneMasked: "138****8000" },
          profile: null,
        },
      }));
      await verifyPromise;
    });

    expect(verifyResult).toBeUndefined();
    expect(result.current.isVerified).toBe(false);
    expect(result.current.message).toBe("");
  });

  it("验证等待期间取消后重新同意仍要等旧请求结束", async () => {
    const pendingResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingResponse.promise);
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", code: "123456", agreed: true });

    let firstPromise!: Promise<unknown>;
    act(() => {
      firstPromise = result.current.verifyAccount();
    });
    setAccountInput(result, { agreed: false });
    setAccountInput(result, { agreed: true });

    await act(async () => {
      await result.current.verifyAccount();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);

    await act(async () => {
      pendingResponse.resolve(jsonResponse({
        data: {
          user: { id: "user-1", phoneMasked: "138****8000" },
          profile: null,
        },
      }));
      await firstPromise;
    });

    expect(result.current.busy).toBe(false);
    expect(result.current.isVerified).toBe(false);
    expect(result.current.message).toBe("");
  });

  it("网络失败和无法解析的响应显示统一连接提示", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    await act(async () => {
      await result.current.sendCode();
    });
    expect(result.current.message).toBe(connectionErrorMessage);

    await act(async () => {
      await result.current.sendCode();
    });
    expect(result.current.message).toBe(connectionErrorMessage);
  });

  it("正常 HTTP 业务错误继续显示后端 message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      error: { code: "OTP_INVALID", message: "验证码不正确或已过期。" },
    }, 400));
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", code: "000000", agreed: true });

    await act(async () => {
      await result.current.verifyAccount();
    });

    expect(result.current.message).toBe("验证码不正确或已过期。");
    expect(result.current.isVerified).toBe(false);
  });

  it("修改手机号后忽略旧结果，并在旧请求结束后允许重新发送", async () => {
    const oldResponse = deferred<Response>();
    const currentResponse = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(currentResponse.promise);
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", code: "111111", agreed: true });

    let oldResult: Awaited<ReturnType<typeof requestOtp>> | undefined;
    let oldPromise!: Promise<void>;
    act(() => {
      oldPromise = result.current.sendCode().then((value) => {
        oldResult = value;
      });
    });
    setAccountInput(result, { phone: "13900139000", code: "222222" });

    let currentResult: Awaited<ReturnType<typeof requestOtp>> | undefined;
    let currentPromise!: Promise<void>;
    act(() => {
      currentPromise = result.current.sendCode().then((value) => {
        currentResult = value;
      });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(currentResult).toBeUndefined();

    await act(async () => {
      oldResponse.resolve(jsonResponse({
        data: { sent: true, expiresIn: 120, devCode: "123456" },
      }));
      await oldPromise;
    });
    expect(oldResult).toBeUndefined();
    expect(result.current.message).toBe("");
    expect(result.current.secondsUntilResend).toBe(0);

    act(() => {
      currentPromise = result.current.sendCode().then((value) => {
        currentResult = value;
      });
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      currentResponse.resolve(jsonResponse({
        data: { sent: true, expiresIn: 300, devCode: "654321" },
      }));
      await currentPromise;
    });

    expect(currentResult).toEqual({ sent: true, expiresIn: 300, devCode: "654321" });
    expect(result.current.message).toBe("本地演示验证码：654321，有效期 5 分钟。");
    expect(result.current.secondsUntilResend).toBe(60);
    expect(result.current.isVerified).toBe(false);
  });

  it("验证期间修改手机号或验证码后忽略旧响应并返回 undefined", async () => {
    const pendingResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingResponse.promise);
    const { result } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", code: "123456", agreed: true });

    let verifyResult: Awaited<ReturnType<typeof verifyOtp>> | undefined;
    let verifyPromise!: Promise<void>;
    act(() => {
      verifyPromise = result.current.verifyAccount().then((value) => {
        verifyResult = value;
      });
    });
    setAccountInput(result, { phone: "13900139000", code: "654321" });

    await act(async () => {
      pendingResponse.resolve(jsonResponse({
        data: {
          user: { id: "old-user", phoneMasked: "138****8000" },
          profile: null,
        },
      }));
      await verifyPromise;
    });

    expect(verifyResult).toBeUndefined();
    expect(result.current.message).toBe("");
    expect(result.current.secondsUntilResend).toBe(0);
    expect(result.current.isVerified).toBe(false);
  });

  it("组件卸载后忽略仍在等待的发送响应且不创建倒计时", async () => {
    vi.useFakeTimers();
    const pendingResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingResponse.promise);
    const { result, unmount } = renderHook(() => useOtpAccount());
    setAccountInput(result, { phone: "13800138000", agreed: true });

    let sendResult: Awaited<ReturnType<typeof requestOtp>> | undefined;
    const sendPromise = result.current.sendCode().then((value) => {
      sendResult = value;
    });
    unmount();

    await act(async () => {
      pendingResponse.resolve(jsonResponse({
        data: { sent: true, expiresIn: 300, devCode: "123456" },
      }));
      await sendPromise;
    });

    expect(sendResult).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("OTP API 响应边界", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["空对象", {}],
    ["null", null],
    ["data 不是对象", { data: null }],
    ["缺少字段", { data: {} }],
    ["sent 为 false", { data: { sent: false, expiresIn: 300 } }],
    ["expiresIn 非正数", { data: { sent: true, expiresIn: 0 } }],
    ["expiresIn 非有限数", { data: { sent: true, expiresIn: Number.POSITIVE_INFINITY } }],
    ["devCode 不是6位数字", { data: { sent: true, expiresIn: 300, devCode: "123" } }],
  ])("requestOtp 拒绝%s响应", async (_name, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(responseWithJson(body));

    await expect(requestOtp("13800138000")).rejects.toThrow(connectionErrorMessage);
  });

  it.each([
    ["空对象", {}],
    ["null", null],
    ["data 不是对象", { data: null }],
    ["user 缺失", { data: { profile: null } }],
    ["user.id 为空", { data: { user: { id: "", phoneMasked: "138****8000" }, profile: null } }],
    ["phoneMasked 为空", { data: { user: { id: "user-1", phoneMasked: " " }, profile: null } }],
    ["profile 不是对象或 null", { data: { user: { id: "user-1", phoneMasked: "138****8000" }, profile: [] } }],
  ])("verifyOtp 拒绝%s响应", async (_name, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(responseWithJson(body));

    await expect(verifyOtp("13800138000", "123456")).rejects.toThrow(connectionErrorMessage);
  });

  it("requestOtp 和 verifyOtp 将网络及非 JSON 异常映射为账号提示", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));

    await expect(requestOtp("13800138000")).rejects.toThrow(connectionErrorMessage);
    await expect(verifyOtp("13800138000", "123456")).rejects.toThrow(connectionErrorMessage);
  });

  it("非账号接口的网络和非 JSON 异常使用通用提示", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));

    await expect(getMembers()).rejects.toThrow(generalConnectionErrorMessage);
    await expect(getMembers()).rejects.toThrow(generalConnectionErrorMessage);
  });

  it("畸形 HTTP 错误包分别映射为账号和通用响应异常", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockResolvedValueOnce(jsonResponse({}, 502));

    await expect(requestOtp("13800138000")).rejects.toThrow(connectionErrorMessage);
    await expect(getMembers()).rejects.toThrow(generalConnectionErrorMessage);
  });
});
