import { getConfig } from "./config.js";
import { runDatabaseSeed } from "./database-seed-runner.js";
import { developmentEnvFilePath } from "./dev-environment.js";

try {
  process.loadEnvFile(developmentEnvFilePath);
} catch {
  // Deployed environments may inject settings without a local .env file.
}

try {
  const report = await runDatabaseSeed(getConfig());
  console.log("Database seed complete:", report);
} catch (error) {
  console.error("Database seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
