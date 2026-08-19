import type { SmsCodeRequest, SmsProvider } from "./types.js";

export class ConsoleSmsProvider implements SmsProvider {
  async sendCode(request: SmsCodeRequest): Promise<void> {
    console.info(`[development-sms] ${request.phone}: ${request.code} (${request.expiresInSeconds}s)`);
  }
}

interface HttpSmsProviderOptions {
  webhookUrl: string;
  bearerToken?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class HttpSmsProvider implements SmsProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpSmsProviderOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sendCode(request: SmsCodeRequest): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.bearerToken) headers.Authorization = `Bearer ${this.options.bearerToken}`;
    const response = await this.fetchImpl(this.options.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`SMS webhook returned HTTP ${response.status}`);
  }
}
