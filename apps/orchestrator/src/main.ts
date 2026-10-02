import { Redis } from "@mmoexile/messaging";
import { createLogger, handleShutdownSignals } from "@mmoexile/service-kit";
import { readConfig } from "./config.js";
import { createOrchestrator } from "./app.js";

const config = readConfig();
const logger = createLogger("orchestrator", config.LOG_LEVEL);
const redis = new Redis(config.REDIS_URL);
const orchestrator = createOrchestrator({ config, logger, redis });

handleShutdownSignals({
  logger,
  shutdown: async () => {
    await orchestrator.stop();
    await redis.quit();
  },
});

await orchestrator.start();
await orchestrator.app.listen({ port: config.PORT, host: "0.0.0.0" });
logger.info({ port: config.PORT }, "orchestrator listening");
