import { createRedis, RedisBroker } from "@mmoexile/messaging";
import { createLogger, handleShutdownSignals, logUnhandledRejections } from "@mmoexile/service-kit";
import { readConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = readConfig();
const logger = createLogger("social", config.LOG_LEVEL);
logUnhandledRejections(logger);
const redis = createRedis({ url: config.REDIS_URL, caFile: config.REDIS_CA_FILE });
const broker = new RedisBroker({ redis });
const app = buildApp({ logger, redis, broker });

handleShutdownSignals({
  logger,
  shutdown: async () => {
    await app.close();
    await broker.close();
    await redis.quit();
  },
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
logger.info({ port: config.PORT }, "social listening");
