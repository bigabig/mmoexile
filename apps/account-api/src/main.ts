import { prisma, disconnectDatabase } from "@mmoexile/db";
import { assertNotDevSecrets } from "@mmoexile/auth";
import { createLogger, handleShutdownSignals } from "@mmoexile/service-kit";
import { readConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = readConfig();
assertNotDevSecrets(config.NODE_ENV, [config.SESSION_SECRET]);

const logger = createLogger("account-api", config.LOG_LEVEL);
const app = buildApp({ config, logger, db: prisma });

handleShutdownSignals({
  logger,
  shutdown: async () => {
    await app.close();
    await disconnectDatabase();
  },
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
logger.info({ port: config.PORT }, "account-api listening");
