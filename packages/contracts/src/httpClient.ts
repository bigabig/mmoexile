import type { z } from "zod";
import { ErrorResponse } from "./accountApi.js";

/** A route described by its method, path, request body and response schema. */
export interface RouteContract {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body: z.ZodType;
  response: z.ZodType;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  /** Sent as "Authorization: Bearer <token>" when set. */
  token?: () => string | undefined;
  fetch?: typeof fetch;
}

/**
 * Calls routes defined in this package. The response is validated with the
 * route's schema, so both sides of a call agree on the shape at runtime.
 */
export function createHttpClient(options: HttpClientOptions) {
  const doFetch = options.fetch ?? fetch;

  return async function call<R extends RouteContract>(
    route: R,
    body: z.input<R["body"]>,
    params: { path?: string } = {},
  ): Promise<z.output<R["response"]>> {
    const headers: Record<string, string> = {};
    const token = options.token?.();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await doFetch(
      `${options.baseUrl}${params.path ?? route.path}`,
      {
        method: route.method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );

    const json = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = ErrorResponse.safeParse(json);
      throw new HttpError(
        response.status,
        parsed.success ? parsed.data.error : `HTTP ${response.status}`,
      );
    }
    return route.response.parse(json) as z.output<R["response"]>;
  };
}
