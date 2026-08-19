import { useCallback, useEffect, useRef, useState } from "react";
import { requestOtp, verifyOtp } from "../api/client";

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const RESEND_SECONDS = 60;

type MessageKind = "idle" | "sending" | "otp-sent" | "verifying" | "verified" | "error";

interface MessageState {
  kind: MessageKind;
  text: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useOtpAccount() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [messageState, setMessageState] = useState<MessageState>({ kind: "idle", text: "" });
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [secondsUntilResend, setSecondsUntilResend] = useState(0);
  const [isVerified, setIsVerified] = useState(false);

  const phoneRef = useRef("");
  const codeRef = useRef("");
  const agreedRef = useRef(false);
  const mountedRef = useRef(true);
  const messageKindRef = useRef<MessageKind>("idle");
  const sendRequestIdRef = useRef(0);
  const verifyRequestIdRef = useRef(0);
  const activeSendIdRef = useRef<number | null>(null);
  const activeVerifyIdRef = useRef<number | null>(null);
  const sendInFlightRef = useRef(false);
  const verifyInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeSendIdRef.current = null;
      activeVerifyIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (secondsUntilResend <= 0) return;

    const timer = window.setInterval(() => {
      setSecondsUntilResend((seconds) => Math.max(0, seconds - 1));
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [secondsUntilResend > 0]);

  const updateMessage = useCallback((kind: MessageKind, text: string) => {
    messageKindRef.current = kind;
    if (mountedRef.current) setMessageState({ kind, text });
  }, []);

  const invalidateSend = useCallback(() => {
    activeSendIdRef.current = null;
  }, []);

  const invalidateVerify = useCallback(() => {
    activeVerifyIdRef.current = null;
  }, []);

  const updatePhone = useCallback((value: string) => {
    if (phoneRef.current === value) return;
    phoneRef.current = value;
    setPhone(value);
    invalidateSend();
    invalidateVerify();
    setSecondsUntilResend(0);
    setIsVerified(false);
    updateMessage("idle", "");
  }, [invalidateSend, invalidateVerify, updateMessage]);

  const updateCode = useCallback((value: string) => {
    if (codeRef.current === value) return;
    codeRef.current = value;
    setCode(value);
    invalidateVerify();
    setIsVerified(false);

    if (messageKindRef.current !== "otp-sent" && messageKindRef.current !== "sending") {
      updateMessage("idle", "");
    }
  }, [invalidateVerify, updateMessage]);

  const updateAgreed = useCallback((value: boolean) => {
    if (agreedRef.current === value) return;
    agreedRef.current = value;
    setAgreed(value);
    invalidateSend();
    invalidateVerify();
    setIsVerified(false);

    if (messageKindRef.current !== "otp-sent") {
      updateMessage("idle", "");
    }
  }, [invalidateSend, invalidateVerify, updateMessage]);

  const validateAgreementAndPhone = useCallback(() => {
    if (!agreedRef.current) {
      updateMessage("error", "请先阅读并同意用户协议和隐私政策。");
      return false;
    }
    if (!PHONE_PATTERN.test(phoneRef.current)) {
      updateMessage("error", "请输入正确的11位手机号。");
      return false;
    }
    return true;
  }, [updateMessage]);

  const hasActiveRequest = useCallback(() => (
    sendInFlightRef.current || verifyInFlightRef.current
  ), []);

  const sendCode = useCallback(async () => {
    if (!validateAgreementAndPhone() || secondsUntilResend > 0 || hasActiveRequest()) return undefined;

    const requestId = ++sendRequestIdRef.current;
    const phoneSnapshot = phoneRef.current;
    const agreedSnapshot = agreedRef.current;
    activeSendIdRef.current = requestId;
    sendInFlightRef.current = true;
    setSending(true);
    updateMessage("sending", "");

    const isCurrentSend = () => mountedRef.current
      && activeSendIdRef.current === requestId
      && phoneRef.current === phoneSnapshot
      && agreedRef.current === agreedSnapshot;

    try {
      const result = await requestOtp(phoneSnapshot);
      if (!isCurrentSend()) return undefined;

      setSecondsUntilResend(RESEND_SECONDS);
      if (result.devCode) {
        const validMinutes = Math.max(1, Math.ceil(result.expiresIn / 60));
        updateMessage("otp-sent", `本地演示验证码：${result.devCode}，有效期 ${validMinutes} 分钟。`);
      } else {
        updateMessage("otp-sent", "验证码已发送，请查收短信。");
      }
      return result;
    } catch (error) {
      if (!isCurrentSend()) return undefined;
      updateMessage("error", errorMessage(error, "验证码发送失败，请稍后重试。"));
      return undefined;
    } finally {
      sendInFlightRef.current = false;
      if (activeSendIdRef.current === requestId) activeSendIdRef.current = null;
      if (mountedRef.current) setSending(false);
    }
  }, [hasActiveRequest, secondsUntilResend, updateMessage, validateAgreementAndPhone]);

  const verifyAccount = useCallback(async () => {
    if (!validateAgreementAndPhone() || hasActiveRequest()) return undefined;

    const phoneSnapshot = phoneRef.current;
    const codeSnapshot = codeRef.current;
    const agreedSnapshot = agreedRef.current;
    if (!/^\d{6}$/.test(codeSnapshot)) {
      updateMessage("error", "请输入6位数字验证码。");
      return undefined;
    }

    const requestId = ++verifyRequestIdRef.current;
    activeVerifyIdRef.current = requestId;
    verifyInFlightRef.current = true;
    setVerifying(true);
    messageKindRef.current = "verifying";

    const isCurrentVerify = () => mountedRef.current
      && activeVerifyIdRef.current === requestId
      && phoneRef.current === phoneSnapshot
      && codeRef.current === codeSnapshot
      && agreedRef.current === agreedSnapshot;

    try {
      const result = await verifyOtp(phoneSnapshot, codeSnapshot);
      if (!isCurrentVerify()) return undefined;

      setIsVerified(true);
      updateMessage("verified", "账号验证成功。");
      return result;
    } catch (error) {
      if (!isCurrentVerify()) return undefined;
      setIsVerified(false);
      updateMessage("error", errorMessage(error, "账号验证失败，请稍后重试。"));
      return undefined;
    } finally {
      verifyInFlightRef.current = false;
      if (activeVerifyIdRef.current === requestId) activeVerifyIdRef.current = null;
      if (mountedRef.current) setVerifying(false);
    }
  }, [hasActiveRequest, updateMessage, validateAgreementAndPhone]);

  return {
    phone,
    setPhone: updatePhone,
    code,
    setCode: updateCode,
    agreed,
    setAgreed: updateAgreed,
    message: messageState.text,
    busy: sending || verifying,
    secondsUntilResend,
    isVerified,
    sendCode,
    verifyAccount,
  };
}
