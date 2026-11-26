import { hmacHex, timingSafeEqual, verifyPassword } from "./crypto";
import { base32Decode, verifyTotp } from "./totp";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSWORD_HASH: string; // from `npm run enroll`
  TOTP_SECRET: string; // base32, from `npm run enroll`
  SESSION_SECRET: string; // random hex, from `npm run enroll`
}

const COOKIE = "qt_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const enc = new TextEncoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Non-API requests only reach here for static files (see wrangler.toml).
    if (!url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await env.ASSETS.fetch(request));
    }

    try {
      return withSecurityHeaders(await handleApi(request, env, url));
    } catch (err) {
      console.error(err);
      return json({ error: "server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;

  if (pathname === "/api/login" && request.method === "POST") return login(request, env, url);
  if (pathname === "/api/logout" && request.method === "POST") return logout(request, url);
  if (pathname === "/api/session" && request.method === "GET") {
    return json({ authenticated: await isAuthenticated(request, env) });
  }

  if (!(await isAuthenticated(request, env))) return json({ error: "unauthorized" }, 401);
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

  if (pathname === "/api/quotes") return listQuotes(url, env);
  if (pathname === "/api/books") return listBooks(env);
  return json({ error: "not found" }, 404);
}

async function login(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);

  const body = (await request.json().catch(() => null)) as
    | { password?: unknown; code?: unknown }
    | null;
  if (!body || typeof body.password !== "string" || typeof body.code !== "string") {
    return json({ error: "invalid request" }, 400);
  }

  const passwordOk = await verifyPassword(body.password, env.APP_PASSWORD_HASH);
  const row = await env.DB.prepare("SELECT last_counter FROM totp_state WHERE id = 1").first<{
    last_counter: number;
  }>();
  const counter = await verifyTotp(base32Decode(env.TOTP_SECRET), body.code, row?.last_counter ?? -1);

  if (!passwordOk || counter === null) return json({ error: "invalid credentials" }, 401);

  // Conditional update: if a concurrent request already used this step, changes = 0.
  const result = await env.DB.prepare(
    "UPDATE totp_state SET last_counter = ? WHERE id = 1 AND last_counter < ?",
  )
    .bind(counter, counter)
    .run();
  if (result.meta.changes === 0) return json({ error: "invalid credentials" }, 401);

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = `${exp}.${await hmacHex(env.SESSION_SECRET, `session:${exp}`)}`;
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL_SECONDS) });
}

function logout(request: Request, url: URL): Response {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const raw = readCookie(request, COOKIE);
  if (!raw) return false;
  const [expStr, sig] = raw.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = await hmacHex(env.SESSION_SECRET, `session:${expStr}`);
  return timingSafeEqual(enc.encode(sig), enc.encode(expected));
}

async function listQuotes(url: URL, env: Env): Promise<Response> {
  const book = url.searchParams.get("book");
  const series = url.searchParams.get("series");
  const q = url.searchParams.get("q");

  const { results } = await env.DB.prepare(
    `SELECT q.id, q.text, q.page, q.attribution, q.created_at,
            b.id AS book_id, b.title AS book_title, b.author, b.series_position,
            s.id AS series_id, s.name AS series_name
       FROM quotes q
       JOIN books b ON b.id = q.book_id
       LEFT JOIN series s ON s.id = b.series_id
      WHERE (?1 IS NULL OR b.id = ?1)
        AND (?2 IS NULL OR s.id = ?2)
        AND (?3 IS NULL OR q.text LIKE ?3)
      ORDER BY s.name, b.series_position, b.title, q.created_at`,
  )
    .bind(book, series, q ? `%${q}%` : null)
    .all();

  return json({ quotes: results });
}

async function listBooks(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.title, b.author, b.series_position,
            s.id AS series_id, s.name AS series_name
       FROM books b
       LEFT JOIN series s ON s.id = b.series_id
      ORDER BY s.name, b.series_position, b.title`,
  ).all();
  return json({ books: results });
}

// Blocks cross-site POSTs. SameSite=Strict on the cookie is the main defense.
function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return origin === null || origin === url.origin;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(value: string, maxAge: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(res.body, { status: res.status, headers });
}
