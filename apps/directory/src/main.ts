import { createLogger, handleShutdownSignals, logUnhandledRejections } from "@mmoexile/service-kit";
import { readConfig } from "./config.js";
import { buildDirectory } from "./app.js";

const config = readConfig();
const logger = createLogger("directory", config.LOG_LEVEL);
logUnhandledRejections(logger);
const app = buildDirectory({ config, logger });

handleShutdownSignals({ logger, shutdown: () => app.close() });

await app.listen({ port: config.PORT, host: "0.0.0.0" });
logger.info(
  { port: config.PORT, regions: config.REGIONS.map((r) => r.id) },
  "directory listening",
);
