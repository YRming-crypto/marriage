export interface SmsCodeRequest {
  phone: string;
  code: string;
  expiresInSeconds: number;
}

export interface SmsProvider {
  sendCode(request: SmsCodeRequest): Promise<void>;
}

export interface ObjectUploadRequest {
  userId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  purpose?: "profile-photo" | "moment-image";
  objectKey?: string;
}

export interface ObjectUploadResult {
  key: string;
  url: string;
}

export interface ObjectReadResult {
  data: Buffer;
  mimeType: string;
}

export interface ObjectStorageProvider {
  upload(request: ObjectUploadRequest): Promise<ObjectUploadResult>;
  read(key: string): Promise<ObjectReadResult>;
  delete(key: string): Promise<void>;
  healthCheck?(): Promise<void>;
}

export type AvatarTopicKey = "life" | "relationship" | "communication" | "privacy" | "general";

export interface AvatarReplyRequest {
  question: string;
  topic?: AvatarTopicKey;
  approvedFacts: Array<{ topic: string; fact: string }>;
  expectations: string[];
  boundaries: string[];
  unknownResponse: string;
}

export interface AvatarModelProvider {
  reply(request: AvatarReplyRequest): Promise<string>;
}

export interface PlatformProviders {
  sms: SmsProvider;
  objectStorage: ObjectStorageProvider;
  avatarModel: AvatarModelProvider;
}
