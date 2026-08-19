import { readFile } from "node:fs/promises";
import type { AppConfig } from "./config.js";
import { seedDatabase, type DatabaseSeedReport } from "./database-seed.js";
import { createProviders } from "./providers/index.js";
import { createPrismaStore } from "./store/index.js";

export function assertDatabaseSeedConfig(config: AppConfig) {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to seed the PostgreSQL database.");
  }
  if (config.objectStorageProvider !== "s3") {
    throw new Error("OBJECT_STORAGE_PROVIDER=s3 is required so seeded photos survive API restarts.");
  }
  const missing = [
    ["S3_REGION", config.s3Region],
    ["S3_ACCESS_KEY", config.s3AccessKey],
    ["S3_SECRET_KEY", config.s3SecretKey],
    ["S3_BUCKET", config.s3Bucket],
    ["S3_PUBLIC_BASE_URL", config.s3PublicBaseUrl],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing persistent object storage settings: ${missing.join(", ")}.`);
  }
  return { databaseUrl: config.databaseUrl, encryptionKey: config.encryptionKey };
}

export async function runDatabaseSeed(config: AppConfig): Promise<DatabaseSeedReport> {
  const runtime = assertDatabaseSeedConfig(config);
  const persistence = createPrismaStore(runtime.databaseUrl, runtime.encryptionKey);
  const providers = createProviders(config, {}, false);
  try {
    return await seedDatabase({
      persistence,
      objectStorage: providers.objectStorage,
      loadPhoto: (filename) => readFile(new URL(`../../web/public/images/${filename}`, import.meta.url)),
    });
  } finally {
    await persistence.close();
  }
}
