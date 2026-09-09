// Request/response plumbing shared by every function.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-org-id",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Safety net: a BigInt anywhere in a payload makes JSON.stringify throw, which
// surfaces as an opaque 500. db.ts parses int8 as Number so this should never
// fire, but one stray bigint should not take an endpoint down.
const jsonSafe = (_key: string, value: unknown) =>
  typeof value === "bigint" ? Number(value) : value;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, jsonSafe), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const noContent = () => new Response(null, { status: 204, headers: corsHeaders });

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Expected a JSON body", "INVALID_JSON");
  }
}

/**
 * A tiny path router. Patterns look like "GET /contacts/:id"; the matched
 * params come back as strings, and the query string is parsed alongside so a
 * handler never has to touch the raw URL.
 */
export type Handler = (ctx: {
  req: Request;
  params: Record<string, string>;
  query: URLSearchParams;
}) => Promise<Response> | Response;

type Route = { method: string; segments: string[]; handler: Handler };

export class Router {
  private routes: Route[] = [];

  add(pattern: string, handler: Handler) {
    const [method, path] = pattern.split(" ");
    this.routes.push({
      method,
      segments: path.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  /**
   * `mountedAt` is the function name Supabase prefixes to every path
   * (/functions/v1/api/contacts arrives as /api/contacts), so it is stripped
   * before matching.
   */
  async handle(req: Request, mountedAt: string): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === mountedAt) segments.shift();

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      if (route.segments.length !== segments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const pattern = route.segments[i];
        if (pattern.startsWith(":")) params[pattern.slice(1)] = decodeURIComponent(segments[i]);
        else if (pattern !== segments[i]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;

      return await route.handler({ req, params, query: url.searchParams });
    }

    throw new HttpError(404, `No route for ${req.method} /${segments.join("/")}`, "NOT_FOUND");
  }
}

/** Turns thrown errors into the JSON shape the mobile client expects. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  console.error("Unhandled error:", error);
  return json({ error: "Internal server error", code: "INTERNAL" }, 500);
}

/** Parses ?limit= with a sane ceiling so one client can't ask for everything. */
export const parseLimit = (query: URLSearchParams, fallback = 50, max = 200) => {
  const raw = Number(query.get("limit"));
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
};
