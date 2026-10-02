import { prisma, disconnectDatabase } from "@mmoexile/db";
import { RedisBroker, Redis } from "@mmoexile/messaging";
import { assertNotDevSecrets } from "@mmoexile/auth";
import { createLogger, handleShutdownSignals } from "@mmoexile/service-kit";
import { readConfig } from "./config.js";
import { createInstanceServer } from "./server.js";

const config = readConfig();
assertNotDevSecrets(config.NODE_ENV, [config.TICKET_PUBLIC_KEY]);

const logger = createLogger(`instance-server-${config.SERVER_ID}`, config.LOG_LEVEL);
const redis = new Redis(config.REDIS_URL);
const broker = new RedisBroker({ redis });

const server = await createInstanceServer({ config, logger, db: prisma, redis, broker });

handleShutdownSignals({
  logger,
  shutdown: async () => {
    await server.stop();
    await broker.close();
    await redis.quit();
    await disconnectDatabase();
  },
});

const port = await server.listen(config.PORT);
logger.info({ port, websocket: `ws://localhost:${port}/ws` }, "Listening");
