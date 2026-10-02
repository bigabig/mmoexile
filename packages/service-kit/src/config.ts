import { z } from "zod";

/**
 * Parses environment variables with a zod schema. Fails fast at startup with
 * every problem listed, instead of crashing later on a missing value.
 */
export function loadConfig<T extends z.ZodType>(
  schema: T,
  env: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Config every service shares. Extend it with `.extend({...})`. */
export const baseConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});
