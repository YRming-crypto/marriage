import { describe, expect, it, vi } from "vitest";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  DeterministicAvatarModelProvider,
  HttpSmsProvider,
  OpenAiCompatibleAvatarModelProvider,
  S3ObjectStorageProvider,
} from "./index.js";

const sensitiveOutputFallback = "出于隐私保护，我不能提供联系方式、证件号码、银行卡号、详细住址或外部链接。";

describe("production providers", () => {
  it("posts an OTP to the SMS webhook with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const provider = new HttpSmsProvider({
      webhookUrl: "https://sms.example/send",
      bearerToken: "sms-secret",
      fetch: fetchMock as typeof fetch,
    });

    await provider.sendCode({ phone: "13800138000", code: "654321", expiresInSeconds: 180 });

    expect(fetchMock).toHaveBeenCalledWith("https://sms.example/send", {
      method: "POST",
      headers: {
        "Authorization": "Bearer sms-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: "13800138000", code: "654321", expiresInSeconds: 180 }),
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects when the SMS webhook returns a failure status", async () => {
    const provider = new HttpSmsProvider({
      webhookUrl: "https://sms.example/send",
      fetch: vi.fn().mockResolvedValue(new Response("denied", { status: 503 })) as typeof fetch,
    });

    await expect(provider.sendCode({ phone: "13800138000", code: "654321", expiresInSeconds: 180 }))
      .rejects.toThrow("SMS webhook returned HTTP 503");
  });

  it("puts and deletes an object in S3-compatible storage", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) }, ContentType: "image/png" })
      .mockResolvedValueOnce({});
    const provider = new S3ObjectStorageProvider({
      bucket: "marriage-photos",
      publicBaseUrl: "https://cdn.example/assets",
      client: { send },
      keyFactory: () => "photos/user-id/photo-id.png",
    });

    const uploaded = await provider.upload({
      userId: "user-id",
      filename: "me.png",
      mimeType: "image/png",
      data: Buffer.from("photo bytes"),
    });
    const object = await provider.read(uploaded.key);
    await provider.delete(uploaded.key);
    await provider.healthCheck();

    expect(uploaded).toEqual({
      key: "photos/user-id/photo-id.png",
      url: "https://cdn.example/assets/photos/user-id/photo-id.png",
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: "marriage-photos",
      Key: "photos/user-id/photo-id.png",
      Body: Buffer.from("photo bytes"),
      ContentType: "image/png",
    });
    expect(object).toEqual({ data: Buffer.from([1, 2, 3]), mimeType: "image/png" });
    expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
    expect(send.mock.calls[2][0].input).toMatchObject({
      Bucket: "marriage-photos",
      Key: "photos/user-id/photo-id.png",
    });
    expect(send.mock.calls[3][0]).toBeInstanceOf(HeadBucketCommand);
    expect(send.mock.calls[3][0].input).toEqual({ Bucket: "marriage-photos" });
  });

  it("stores member moments outside the profile photo namespace", async () => {
    const send = vi.fn().mockResolvedValue({});
    const provider = new S3ObjectStorageProvider({
      bucket: "marriage-photos",
      publicBaseUrl: "https://cdn.example/assets",
      client: { send },
    });

    const uploaded = await provider.upload({
      userId: "user-id",
      filename: "daily.png",
      mimeType: "image/png",
      data: Buffer.from("moment bytes"),
      purpose: "moment-image",
      objectKey: "moments/user-id/reserved-moment.png",
    });

    expect(uploaded.key).toBe("moments/user-id/reserved-moment.png");
    expect(uploaded.key).not.toMatch(/^photos\//);
    expect(send.mock.calls[0][0].input).toMatchObject({ Key: "moments/user-id/reserved-moment.png" });
  });

  it("sends only authorized avatar context to the model endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "她希望先从真诚交流开始。" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleAvatarModelProvider({
      endpoint: "https://model.example/v1/chat/completions",
      apiKey: "model-secret",
      model: "safe-chat",
      fetch: fetchMock as typeof fetch,
    });

    const answer = await provider.reply({
      question: "她期待怎样的关系？",
      approvedFacts: [{ topic: "生活", fact: "周末喜欢阅读，旧资料里误填了 13800138000" }],
      expectations: ["认真交往"],
      boundaries: ["不公开联系方式"],
      unknownResponse: "这个问题没有得到本人授权。",
    });

    expect(answer).toBe("她希望先从真诚交流开始。");
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({ model: "safe-chat", stream: false });
    const serializedMessages = JSON.stringify(requestBody.messages);
    expect(serializedMessages).toContain("周末喜欢阅读");
    expect(serializedMessages).not.toContain("13800138000");
    expect(serializedMessages).toContain("认真交往");
    expect(serializedMessages).toContain("不公开联系方式");
    expect(serializedMessages).not.toMatch(/1[3-9]\d{9}/);
  });

  it("redacts sensitive information before sending avatar context to the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "她希望先从真诚交流开始。" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAiCompatibleAvatarModelProvider({
      endpoint: "https://model.example/v1/chat/completions",
      model: "safe-chat",
      fetch: fetchMock as typeof fetch,
    });
    const sensitiveValues = [
      "138-0013-8000",
      "person@example.com",
      "微信号 lily_2026",
      "QQ号 123456789",
      "110105199001011234",
      "6222 0202 0123 4567 890",
      "住址：北京市朝阳区建国路88号2栋301室",
      "https://example.com/profile?id=1",
    ];

    await provider.reply({
      question: `怎么联系？${sensitiveValues.join("；")}`,
      approvedFacts: [{ topic: "生活", fact: sensitiveValues.join("；") }],
      expectations: [`认真交往；${sensitiveValues.join("；")}`],
      boundaries: [`不公开隐私；${sensitiveValues.join("；")}`],
      unknownResponse: "这个问题没有得到本人授权。",
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const serializedMessages = JSON.stringify(requestBody.messages);
    for (const sensitiveValue of sensitiveValues) {
      expect(serializedMessages).not.toContain(sensitiveValue);
    }
    expect(serializedMessages).toContain("[已隐藏手机号]");
    expect(serializedMessages).toContain("[已隐藏邮箱]");
    expect(serializedMessages).toContain("[已隐藏联系方式]");
    expect(serializedMessages).toContain("[已隐藏身份证号]");
    expect(serializedMessages).toContain("[已隐藏银行卡号]");
    expect(serializedMessages).toContain("[已隐藏详细住址]");
    expect(serializedMessages).toContain("[已隐藏外部链接]");
  });

  it("keeps the authorized fact while varying the reply wording by topic", async () => {
    const provider = new DeterministicAvatarModelProvider();

    const answer = await provider.reply({
      question: "她周末喜欢做什么？",
      approvedFacts: [{ topic: "生活", fact: "周末喜欢阅读和在公园散步" }],
      expectations: ["认真交往"],
      boundaries: ["慢慢了解"],
      unknownResponse: "这个问题没有得到本人授权。",
    });

    expect(answer).toContain("周末喜欢阅读和在公园散步");
    expect(answer).toContain("生活");
  });

  it("returns different content based on the question topic", async () => {
    const provider = new DeterministicAvatarModelProvider();

    const lifeReply = await provider.reply({
      question: "他周末喜欢做什么？",
      approvedFacts: [{ topic: "生活", fact: "周末喜欢在公园散步和读书" }],
      expectations: ["认真交往"],
      boundaries: ["慢慢了解"],
      unknownResponse: "这个问题没有得到本人授权。",
    });

    const relationshipReply = await provider.reply({
      question: "他期待怎样的关系？",
      approvedFacts: [{ topic: "关系", fact: "愿意从真诚沟通开始，慢慢建立长期关系" }],
      expectations: ["认真交往"],
      boundaries: ["慢慢了解"],
      unknownResponse: "这个问题没有得到本人授权。",
    });

    expect(lifeReply).toContain("生活");
    expect(relationshipReply).toContain("关系");
    expect(lifeReply).not.toBe(relationshipReply);
  });

  it("rejects model transport failures", async () => {
    const failed = new OpenAiCompatibleAvatarModelProvider({
      endpoint: "https://model.example/v1/chat/completions",
      model: "safe-chat",
      fetch: vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })) as typeof fetch,
    });
    await expect(failed.reply({
      question: "你好",
      approvedFacts: [],
      expectations: [],
      boundaries: [],
      unknownResponse: "未授权",
    })).rejects.toThrow("Avatar model returned HTTP 503");
  });

  it.each([
    ["手机号", "可以拨打 +86 138-0013-8000 联系她"],
    ["邮箱", "她的邮箱是 person@example.com"],
    ["微信", "她的微信号是 lily_2026"],
    ["QQ", "她的QQ号是 123456789"],
    ["身份证号", "她的身份证号是 110105199001011234"],
    ["银行卡号", "请转到银行卡 6222 0202 0123 4567 890"],
    ["详细住址", "她的住址是北京市朝阳区建国路88号2栋301室"],
    ["外部链接", "更多资料见 https://example.com/profile?id=1"],
  ])("returns a safe fallback when model output contains %s", async (_kind, unsafeOutput) => {
    const unsafe = new OpenAiCompatibleAvatarModelProvider({
      endpoint: "https://model.example/v1/chat/completions",
      model: "safe-chat",
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{ message: { content: unsafeOutput } }],
      }), { status: 200 })) as typeof fetch,
    });
    await expect(unsafe.reply({
      question: "联系方式是什么？",
      approvedFacts: [],
      expectations: [],
      boundaries: ["不公开联系方式"],
      unknownResponse: "未授权",
    })).resolves.toBe(sensitiveOutputFallback);
  });
});
