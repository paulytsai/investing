// Small helpers for Netlify Functions v2 (Request -> Response).

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function error(status, code, message, extra) {
  return json({ error: code, message: message || code, ...extra }, status);
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON");
  }
}

/** Wrap a handler so thrown HttpErrors become JSON responses. */
export function handler(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.code, e.message, e.extra);
      console.error("Unhandled error", e);
      if (e && e.name === "FmpError") return error(502, "upstream_fmp", String(e.message).slice(0, 300));
      return error(500, "internal_error", e && e.message ? String(e.message).slice(0, 200) : "Internal error");
    }
  };
}

export function param(context, name) {
  return context?.params?.[name];
}

export function query(req) {
  return new URL(req.url).searchParams;
}
