import { prepareDevelopmentEnvironment } from "./dev-environment.js";

prepareDevelopmentEnvironment();

await import("./start.js");
