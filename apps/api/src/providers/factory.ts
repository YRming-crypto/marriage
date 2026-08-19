import type { AppConfig } from "../config.js";
import { DeterministicAvatarModelProvider, OpenAiCompatibleAvatarModelProvider } from "./avatar-model.js";
import { DataUrlObjectStorageProvider, S3ObjectStorageProvider } from "./object-storage.js";
import { ConsoleSmsProvider, HttpSmsProvider } from "./sms.js";
import type { PlatformProviders } from "./types.js";

export function createProviders(
  config: AppConfig,
  overrides: Partial<PlatformProviders> = {},
  validateProduction = true,
): PlatformProviders {
  if (config.nodeEnv === "production" && validateProduction) {
    if (!overrides.sms && (config.smsProvider !== "http" || !config.smsWebhookUrl)) {
      throw new Error("SMS_PROVIDER=http and SMS_WEBHOOK_URL are required in production.");
    }
    if (!overrides.objectStorage && config.objectStorageProvider !== "s3") {
      throw new Error("OBJECT_STORAGE_PROVIDER=s3 is required in production; data URL storage is forbidden.");
    }
    if (!overrides.objectStorage && (!config.s3Bucket || !config.s3Region || !config.s3AccessKey || !config.s3SecretKey || !config.s3PublicBaseUrl)) {
      throw new Error("S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY and S3_PUBLIC_BASE_URL are required in production.");
    }
    if (!overrides.avatarModel && (config.avatarModelProvider !== "openai" || !config.avatarModelEndpoint || !config.avatarModelApiKey || !config.avatarModelName)) {
      throw new Error("AVATAR_MODEL_PROVIDER=openai, AVATAR_MODEL_ENDPOINT, AVATAR_MODEL_API_KEY and AVATAR_MODEL_NAME are required in production.");
    }
  }

  const sms = overrides.sms ?? (config.smsProvider === "http"
    ? new HttpSmsProvider({ webhookUrl: config.smsWebhookUrl!, bearerToken: config.smsBearerToken })
    : new ConsoleSmsProvider());
  const objectStorage = overrides.objectStorage ?? (config.objectStorageProvider === "s3"
    ? new S3ObjectStorageProvider({
        bucket: config.s3Bucket!,
        publicBaseUrl: config.s3PublicBaseUrl!,
        clientConfig: {
          region: config.s3Region,
          endpoint: config.s3Endpoint,
          forcePathStyle: config.s3ForcePathStyle,
          credentials: config.s3AccessKey && config.s3SecretKey
            ? { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey }
            : undefined,
        },
      })
    : new DataUrlObjectStorageProvider());
  const avatarModel = overrides.avatarModel ?? (config.avatarModelProvider === "openai"
    ? new OpenAiCompatibleAvatarModelProvider({
        endpoint: config.avatarModelEndpoint!,
        apiKey: config.avatarModelApiKey,
        model: config.avatarModelName!,
      })
    : new DeterministicAvatarModelProvider());

  return { sms, objectStorage, avatarModel };
}
