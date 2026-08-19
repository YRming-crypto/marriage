export interface AppConfig {
  nodeEnv: string;
  otpCode?: string;
  otpTtlSeconds: number;
  secureCookies: boolean;
  trustProxy: boolean;
  databaseUrl?: string;
  encryptionKey: string;
  allowedOrigins: string[];
  adminPhones: string[];
  adminAccessCode?: string;
  smsProvider: "console" | "http";
  smsWebhookUrl?: string;
  smsBearerToken?: string;
  objectStorageProvider: "data-url" | "s3";
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3Bucket?: string;
  s3PublicBaseUrl?: string;
  s3ForcePathStyle: boolean;
  avatarModelProvider: "deterministic" | "openai";
  avatarModelEndpoint?: string;
  avatarModelApiKey?: string;
  avatarModelName?: string;
}

const publicEncryptionKeyPlaceholder = "replace-with-a-long-random-secret";

export function getConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? "";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";
  const allowDevelopmentOtp = nodeEnv === "development" && process.env.ALLOW_DEV_OTP === "true";
  const defaultOrigins = isProduction
    ? []
    : [
        "http://127.0.0.1:4183",
        "http://localhost:4183",
        "http://127.0.0.1:4184",
        "http://localhost:4184",
      ];
  const allowedOrigins = overrides.allowedOrigins
    ?? process.env.CORS_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean)
    ?? defaultOrigins;
  const otpCode = isTest
    ? overrides.otpCode
    : allowDevelopmentOtp
      ? overrides.otpCode ?? process.env.DEV_OTP_CODE ?? "123456"
      : undefined;
  const databaseUrl = overrides.databaseUrl ?? (isTest ? undefined : process.env.DATABASE_URL);
  const encryptionKey = overrides.encryptionKey
    ?? process.env.APP_ENCRYPTION_KEY
    ?? "local-development-only-change-me";
  const adminPhones = overrides.adminPhones
    ?? process.env.ADMIN_PHONES?.split(",").map((phone) => phone.trim()).filter(Boolean)
    ?? (isProduction ? [] : ["13900139999"]);
  const adminAccessCode = overrides.adminAccessCode ?? (process.env.ADMIN_ACCESS_CODE?.trim() || undefined);
  const smsProvider = overrides.smsProvider ?? (process.env.SMS_PROVIDER === "http" ? "http" : "console");
  const objectStorageProvider = overrides.objectStorageProvider ?? (process.env.OBJECT_STORAGE_PROVIDER === "s3" ? "s3" : "data-url");
  const avatarModelProvider = overrides.avatarModelProvider ?? (process.env.AVATAR_MODEL_PROVIDER === "openai" ? "openai" : "deterministic");

  if (otpCode !== undefined && !/^\d{6}$/.test(otpCode)) {
    throw new Error("Development OTP code must be exactly 6 digits.");
  }
  if (isProduction && !databaseUrl) {
    throw new Error("DATABASE_URL is required in production.");
  }
  if (isProduction && !process.env.APP_ENCRYPTION_KEY && overrides.encryptionKey === undefined) {
    throw new Error("APP_ENCRYPTION_KEY is required in production.");
  }
  if (isProduction && encryptionKey === publicEncryptionKeyPlaceholder) {
    throw new Error("APP_ENCRYPTION_KEY must not use the public placeholder value in production.");
  }
  if (isProduction && encryptionKey.length < 32) {
    throw new Error("APP_ENCRYPTION_KEY must contain at least 32 characters in production.");
  }
  if (isProduction && allowedOrigins.length === 0) {
    throw new Error("CORS_ALLOWED_ORIGINS is required in production.");
  }
  if (adminAccessCode !== undefined && (adminAccessCode.length < 6 || adminAccessCode.length > 128)) {
    throw new Error("ADMIN_ACCESS_CODE must contain between 6 and 128 characters.");
  }
  if (adminAccessCode !== undefined && otpCode !== undefined && adminAccessCode === otpCode) {
    throw new Error("ADMIN_ACCESS_CODE must be different from the development OTP code.");
  }
  if (isProduction && adminPhones.length > 0 && !adminAccessCode) {
    throw new Error("ADMIN_ACCESS_CODE is required when ADMIN_PHONES is configured in production.");
  }

  return {
    nodeEnv,
    otpCode,
    otpTtlSeconds: overrides.otpTtlSeconds ?? Number(process.env.OTP_TTL_SECONDS ?? 300),
    secureCookies: overrides.secureCookies ?? isProduction,
    trustProxy: overrides.trustProxy ?? (process.env.TRUST_PROXY === "true" || isProduction),
    databaseUrl,
    encryptionKey,
    allowedOrigins,
    adminPhones,
    adminAccessCode,
    smsProvider,
    smsWebhookUrl: overrides.smsWebhookUrl ?? process.env.SMS_WEBHOOK_URL,
    smsBearerToken: overrides.smsBearerToken ?? process.env.SMS_BEARER_TOKEN,
    objectStorageProvider,
    s3Endpoint: overrides.s3Endpoint ?? process.env.S3_ENDPOINT,
    s3Region: overrides.s3Region ?? process.env.S3_REGION,
    s3AccessKey: overrides.s3AccessKey ?? process.env.S3_ACCESS_KEY,
    s3SecretKey: overrides.s3SecretKey ?? process.env.S3_SECRET_KEY,
    s3Bucket: overrides.s3Bucket ?? process.env.S3_BUCKET ?? process.env.MINIO_BUCKET,
    s3PublicBaseUrl: overrides.s3PublicBaseUrl ?? process.env.S3_PUBLIC_BASE_URL,
    s3ForcePathStyle: overrides.s3ForcePathStyle ?? process.env.S3_FORCE_PATH_STYLE === "true",
    avatarModelProvider,
    avatarModelEndpoint: overrides.avatarModelEndpoint ?? process.env.AVATAR_MODEL_ENDPOINT,
    avatarModelApiKey: overrides.avatarModelApiKey ?? process.env.AVATAR_MODEL_API_KEY,
    avatarModelName: overrides.avatarModelName ?? process.env.AVATAR_MODEL_NAME,
  };
}
