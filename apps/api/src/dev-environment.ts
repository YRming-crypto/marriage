import { fileURLToPath } from "node:url";

export const developmentEnvFilePath = fileURLToPath(new URL("../../../.env", import.meta.url));

export function applyDevelopmentStoreOverride(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "development" && env.USE_IN_MEMORY_STORE === "true") {
    delete env.DATABASE_URL;
  }
}

export function enableDevelopmentOtp(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV && env.NODE_ENV !== "development") {
    if (env.NODE_ENV === "production") {
      throw new Error("Refusing to enable development OTP in production.");
    }
    throw new Error(`Refusing to enable development OTP in ${env.NODE_ENV}.`);
  }

  env.NODE_ENV = "development";
  env.ALLOW_DEV_OTP = "true";
}

export function prepareDevelopmentEnvironment(
  loadEnvironment: (path: string) => void = (path) => {
    try {
      process.loadEnvFile(path);
    } catch {
      // Local development can run without an .env file.
    }
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  loadEnvironment(developmentEnvFilePath);
  enableDevelopmentOtp(env);
  applyDevelopmentStoreOverride(env);
}
