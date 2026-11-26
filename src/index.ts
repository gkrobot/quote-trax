import { hashPassword, hmacHex, timingSafeEqual, toHex, verifyPassword } from "./crypto";
import { exportLibrary } from "./export";
import {
  createBook,
  createQuote,
  createSeries,
  deleteBook,
  deleteQuote,
  deleteSeries,
  getStats,
  listSeries,
  updateBook,
  updateQuote,
  updateSeries,
} from "./manage";
import { importExport } from "./import";
import { base32Decode, base32Encode, totpUri, verifyTotp } from "./totp";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_USERNAME: string; // plain Worker variable: the only username allowed to set up
  SETUP_TOKEN: string; // Worker secret: typed once on the setup page
}

type Account = {
  username: string;
  password_hash: string;
  totp_secret: string;
  session_secret: string;
  last_counter: number;
};

const COOKIE = "qt_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

// Step 1 (username + password) issues a short-lived "pending" cookie.
// Step 2 (authenticator code) must present it to get a session.
const PENDING = "qt_pending";
const PENDING_TTL_SECONDS = 300;
const MAX_CODE_ATTEMPTS = 3;

const SETUP_TTL_SECONDS = 600;
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
  const isPost = request.method === "POST";
  const isGet = request.method === "GET";

  if (pathname === "/api/setup/status" && isGet) {
    return json({ needsSetup: (await getAccount(env)) === null });
  }
  if (pathname === "/api/setup/start" && isPost) return setupStart(request, env, url);
  if (pathname === "/api/setup/confirm" && isPost) return setupConfirm(request, env, url);

  if (pathname === "/api/login/password" && isPost) return loginPassword(request, env, url);
  if (pathname === "/api/login/code" && isPost) return loginCode(request, env, url);
  if (pathname === "/api/logout" && isPost) return logout(request, url);
  if (pathname === "/api/session" && isGet) {
    return json({ authenticated: await isAuthenticated(request, env) });
  }

  if (!(await isAuthenticated(request, env))) return json({ error: "unauthorized" }, 401);
  if (pathname === "/api/import" && isPost) return importRoute(request, env, url);
  if (isPost && (pathname === "/api/series" || pathname === "/api/books" || pathname === "/api/quotes")) {
    return createRoute(request, env, url, pathname);
  }
  const item = pathname.match(/^\/api\/(quotes|books|series)\/([^/]+)$/);
  if (item && (request.method === "PUT" || request.method === "DELETE")) {
    return itemRoute(request, env, url, item[1], decodeURIComponent(item[2]));
  }
  if (!isGet) return json({ error: "method not allowed" }, 405);

  if (pathname === "/api/stats") return jsonResult(await getStats(env.DB));
  if (pathname === "/api/series") return jsonResult(await listSeries(env.DB));
  if (pathname === "/api/export") return json(await exportLibrary(env.DB));
  if (pathname === "/api/quotes") return listQuotes(url, env);
  if (pathname === "/api/books") return listBooks(env);
  return json({ error: "not found" }, 404);
}

// Setup, step 1: check the setup token and username, then generate the
// authenticator key on the server and show it once. Nothing is saved as the
// account until the code is confirmed.
async function setupStart(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
  if ((await getAccount(env)) !== null) return json({ error: "not found" }, 404);

  const body = (await request.json().catch(() => null)) as
    | { username?: unknown; password?: unknown; setupToken?: unknown }
    | null;
  if (
    !body ||
    typeof body.username !== "string" ||
    typeof body.password !== "string" ||
    typeof body.setupToken !== "string"
  ) {
    return json({ error: "invalid request" }, 400);
  }

  // Check every condition before answering, so the response doesn't reveal which one failed.
  const tokenOk = timingSafeEqual(enc.encode(body.setupToken), enc.encode(env.SETUP_TOKEN ?? ""));
  const usernameOk = usernameMatches(body.username, env.APP_USERNAME);
  if (!tokenOk || !usernameOk) return json({ error: "setup details not accepted" }, 401);
  if (body.password.length < 12) {
    return json({ error: "password must be at least 12 characters" }, 400);
  }

  const totpSecret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
  const sessionSecret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const passwordHash = await hashPassword(body.password);
  const expiresAt = Math.floor(Date.now() / 1000) + SETUP_TTL_SECONDS;

  await env.DB.prepare(
    `INSERT INTO setup_pending (id, username, password_hash, totp_secret, session_secret, expires_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username,
       password_hash = excluded.password_hash, totp_secret = excluded.totp_secret,
       session_secret = excluded.session_secret, expires_at = excluded.expires_at`,
  )
    .bind(env.APP_USERNAME, passwordHash, totpSecret, sessionSecret, expiresAt)
    .run();

  return json({
    key: totpSecret,
    uri: totpUri(totpSecret, env.APP_USERNAME, "quote-trax"),
  });
}

// Setup, step 2: the user enters a code from the new authenticator entry.
// Only then is the account saved, and setup is closed for good.
async function setupConfirm(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
  if ((await getAccount(env)) !== null) return json({ error: "not found" }, 404);

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  if (!body || typeof body.code !== "string") return json({ error: "invalid request" }, 400);

  const pending = await env.DB.prepare(
    "SELECT username, password_hash, totp_secret, session_secret, expires_at FROM setup_pending WHERE id = 1",
  ).first<{
    username: string;
    password_hash: string;
    totp_secret: string;
    session_secret: string;
    expires_at: number;
  }>();
  if (!pending || pending.expires_at * 1000 < Date.now()) {
    return json({ error: "setup expired; start again" }, 400);
  }

  const counter = await verifyTotp(base32Decode(pending.totp_secret), body.code, -1);
  if (counter === null) return json({ error: "invalid code" }, 401);

  // INSERT OR IGNORE: if two confirms race, only the first creates the account.
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO account (id, username, password_hash, totp_secret, session_secret, last_counter, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      pending.username,
      pending.password_hash,
      pending.totp_secret,
      pending.session_secret,
      counter,
      new Date().toISOString(),
    )
    .run();
  await env.DB.prepare("DELETE FROM setup_pending WHERE id = 1").run();

  if (result.meta.changes === 0) return json({ error: "not found" }, 404);
  return json({ ok: true });
}

// Login, step 1: username and password.
async function loginPassword(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);

  const account = await getAccount(env);
  if (!account) return json({ error: "setup required" }, 409);

  const body = (await request.json().catch(() => null)) as
    | { username?: unknown; password?: unknown }
    | null;
  if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
    return json({ error: "invalid request" }, 400);
  }

  // Check both before deciding, so the response doesn't reveal which one was wrong.
  const usernameOk = usernameMatches(body.username, account.username);
  const passwordOk = await verifyPassword(body.password, account.password_hash);
  if (!usernameOk || !passwordOk) return json({ error: "invalid credentials" }, 401);

  const exp = Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS;
  const token = await pendingToken(account.session_secret, exp, 0);
  return json({ ok: true, next: "code" }, 200, {
    "Set-Cookie": pendingCookie(token, PENDING_TTL_SECONDS),
  });
}

// Login, step 2: authenticator code. Requires a valid pending cookie from step 1.
async function loginCode(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);

  const account = await getAccount(env);
  if (!account) return json({ error: "setup required" }, 409);

  const pending = await readPending(request, account.session_secret);
  if (!pending) {
    return json({ error: "sign in with your password first" }, 401, {
      "Set-Cookie": pendingCookie("", 0),
    });
  }

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  if (!body || typeof body.code !== "string") return json({ error: "invalid request" }, 400);

  const counter = await verifyTotp(base32Decode(account.totp_secret), body.code, account.last_counter);

  // Conditional update: if a concurrent request already used this step, changes = 0.
  let accepted = false;
  if (counter !== null) {
    const result = await env.DB.prepare(
      "UPDATE account SET last_counter = ? WHERE id = 1 AND last_counter < ?",
    )
      .bind(counter, counter)
      .run();
    accepted = result.meta.changes > 0;
  }

  if (!accepted) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      return json({ error: "too many attempts; sign in again" }, 401, {
        "Set-Cookie": pendingCookie("", 0),
      });
    }
    const remaining = pending.exp - Math.floor(Date.now() / 1000);
    const token = await pendingToken(account.session_secret, pending.exp, attempts);
    return json({ error: "invalid code" }, 401, { "Set-Cookie": pendingCookie(token, remaining) });
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = `${exp}.${await hmacHex(account.session_secret, `session:${exp}`)}`;
  const res = json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL_SECONDS) });
  res.headers.append("Set-Cookie", pendingCookie("", 0));
  return res;
}

function logout(request: Request, url: URL): Response {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

async function getAccount(env: Env): Promise<Account | null> {
  return env.DB.prepare(
    "SELECT username, password_hash, totp_secret, session_secret, last_counter FROM account WHERE id = 1",
  ).first<Account>();
}

async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const account = await getAccount(env);
  if (!account) return false;

  const raw = readCookie(request, COOKIE);
  if (!raw) return false;
  const [expStr, sig] = raw.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = await hmacHex(account.session_secret, `session:${expStr}`);
  return timingSafeEqual(enc.encode(sig), enc.encode(expected));
}

// Pending token: "<exp>.<attempts>.<hmac>". Signed, so attempts can't be lowered by hand.
async function pendingToken(secret: string, exp: number, attempts: number): Promise<string> {
  const sig = await hmacHex(secret, `pending:${exp}:${attempts}`);
  return `${exp}.${attempts}.${sig}`;
}

async function readPending(
  request: Request,
  secret: string,
): Promise<{ exp: number; attempts: number } | null> {
  const raw = readCookie(request, PENDING);
  if (!raw) return null;
  const [expStr, attStr, sig] = raw.split(".");
  const exp = Number(expStr);
  const attempts = Number(attStr);
  if (!sig || !Number.isInteger(exp) || !Number.isInteger(attempts)) return null;
  if (exp * 1000 < Date.now() || attempts >= MAX_CODE_ATTEMPTS) return null;
  const expected = await hmacHex(secret, `pending:${expStr}:${attStr}`);
  return timingSafeEqual(enc.encode(sig), enc.encode(expected)) ? { exp, attempts } : null;
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

// Adds a series, book, or quote. Requires a signed-in session.
async function createRoute(request: Request, env: Env, url: URL, pathname: string): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid request" }, 400);
  const fields = body as Record<string, unknown>;

  if (pathname === "/api/series") return jsonResult(await createSeries(env.DB, fields));
  if (pathname === "/api/books") return jsonResult(await createBook(env.DB, fields));
  return jsonResult(await createQuote(env.DB, fields));
}

// Edits (PUT) and deletes (DELETE) a single quote, book, or series by ID.
async function itemRoute(request: Request, env: Env, url: URL, kind: string, id: string): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);

  if (request.method === "DELETE") {
    if (kind === "quotes") return jsonResult(await deleteQuote(env.DB, id));
    if (kind === "books") return jsonResult(await deleteBook(env.DB, id));
    return jsonResult(await deleteSeries(env.DB, id));
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid request" }, 400);
  const fields = body as Record<string, unknown>;
  if (kind === "quotes") return jsonResult(await updateQuote(env.DB, id, fields));
  if (kind === "books") return jsonResult(await updateBook(env.DB, id, fields));
  return jsonResult(await updateSeries(env.DB, id, fields));
}

function jsonResult(r: { status: number; body: unknown }): Response {
  return json(r.body, r.status);
}

// Signed-in users can load an export file. Re-importing updates rows by ID.
async function importRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);

  const data = await request.json().catch(() => null);
  if (data === null) return json({ error: "file is not valid JSON" }, 400);

  const result = await importExport(env.DB, data);
  if (typeof result === "string") return json({ error: result }, 400);
  return json({ ok: true, ...result });
}

function usernameMatches(input: string, expected: string): boolean {
  return timingSafeEqual(
    enc.encode(input.trim().toLowerCase()),
    enc.encode((expected ?? "").trim().toLowerCase()),
  );
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

function pendingCookie(value: string, maxAge: number): string {
  return `${PENDING}=${value}; Path=/api/login; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
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
