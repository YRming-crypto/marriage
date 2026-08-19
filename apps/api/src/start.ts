import { buildServer } from "./server.js";
import { applyDevelopmentStoreOverride, developmentEnvFilePath } from "./dev-environment.js";

try {
  process.loadEnvFile(developmentEnvFilePath);
} catch {
  // A deployed environment may inject variables without a local .env file.
}

applyDevelopmentStoreOverride();

const app = buildServer();
const port = Number(process.env.API_PORT ?? 4184);

try {
  await app.listen({ host: "127.0.0.1", port });
  console.log(`AI marriage API running at http://127.0.0.1:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
