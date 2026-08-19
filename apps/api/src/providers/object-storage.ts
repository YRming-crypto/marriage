import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { ObjectReadResult, ObjectStorageProvider, ObjectUploadRequest, ObjectUploadResult } from "./types.js";

export class DataUrlObjectStorageProvider implements ObjectStorageProvider {
  private readonly objects = new Map<string, ObjectReadResult>();

  async upload(request: ObjectUploadRequest): Promise<ObjectUploadResult> {
    const folder = request.purpose === "moment-image" ? "moments" : "photos";
    const key = request.objectKey ?? `data-url/${folder}/${request.userId}/${randomUUID()}`;
    this.objects.set(key, { data: Buffer.from(request.data), mimeType: request.mimeType });
    return {
      key,
      url: `data:${request.mimeType};base64,${request.data.toString("base64")}`,
    };
  }

  async read(key: string): Promise<ObjectReadResult> {
    const object = this.objects.get(key);
    if (!object) throw new Error("Object not found");
    return { data: Buffer.from(object.data), mimeType: object.mimeType };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async healthCheck(): Promise<void> {
    return undefined;
  }
}

interface S3Sender {
  send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand | HeadBucketCommand): Promise<unknown>;
}

interface S3ObjectStorageProviderOptions {
  bucket: string;
  publicBaseUrl: string;
  client?: S3Sender;
  clientConfig?: S3ClientConfig;
  keyFactory?: (request: ObjectUploadRequest) => string;
}

function safeExtension(filename: string): string {
  const extension = extname(filename).toLowerCase();
  return /^\.(jpe?g|png|webp)$/.test(extension) ? extension : "";
}

function publicObjectUrl(baseUrl: string, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/$/, "")}/${encodedKey}`;
}

export class S3ObjectStorageProvider implements ObjectStorageProvider {
  private readonly client: S3Sender;

  constructor(private readonly options: S3ObjectStorageProviderOptions) {
    this.client = options.client ?? (new S3Client(options.clientConfig ?? {}) as S3Sender);
  }

  async upload(request: ObjectUploadRequest): Promise<ObjectUploadResult> {
    const folder = request.purpose === "moment-image" ? "moments" : "photos";
    const key = request.objectKey ?? this.options.keyFactory?.(request)
      ?? `${folder}/${request.userId}/${randomUUID()}${safeExtension(request.filename)}`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: request.data,
      ContentType: request.mimeType,
    }));
    return { key, url: publicObjectUrl(this.options.publicBaseUrl, key) };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async healthCheck(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
  }

  async read(key: string): Promise<ObjectReadResult> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key })) as {
      Body?: { transformToByteArray?: () => Promise<Uint8Array> };
      ContentType?: string;
    };
    if (!result.Body?.transformToByteArray) throw new Error("Object body is unavailable");
    return {
      data: Buffer.from(await result.Body.transformToByteArray()),
      mimeType: result.ContentType ?? "application/octet-stream",
    };
  }
}
