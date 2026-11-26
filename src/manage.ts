// Create, edit, delete and stats. Each function returns a status and body so the
// router in index.ts can turn it into a response.

export type Result = { status: number; body: unknown };
type Body = Record<string, unknown>;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_QUOTE = 20000;
const MAX_TITLE = 300;
const MAX_NAME = 120;
const MAX_SHORT = 300;

const fail = (error: string, status = 400): Result => ({ status, body: { error } });
const NOT_FOUND = (): Result => fail("not found", 404);

// Required, trimmed string within a length limit.
function requiredText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

// Optional string: empty or missing becomes null. Returns undefined if too long.
function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length <= max ? t || null : undefined;
}

async function rowExists(db: D1Database, table: "series" | "books" | "quotes", id: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first());
}

// ---- Validation shared by create and edit ----

function parseSeriesName(body: Body): Parsed<string> {
  const name = requiredText(body.name, MAX_NAME);
  return name ? { ok: true, value: name } : { ok: false, error: `series name is required (up to ${MAX_NAME} characters)` };
}

async function parseBook(db: D1Database, body: Body): Promise<Parsed<{ title: string; author: string; seriesId: string | null; position: number | null }>> {
  const title = requiredText(body.title, MAX_TITLE);
  if (!title) return { ok: false, error: `book title is required (up to ${MAX_TITLE} characters)` };
  const author = requiredText(body.author, MAX_SHORT);
  if (!author) return { ok: false, error: "author is required" };

  let seriesId: string | null = null;
  if (body.seriesId !== undefined && body.seriesId !== null && body.seriesId !== "") {
    if (typeof body.seriesId !== "string") return { ok: false, error: "invalid series" };
    if (!(await rowExists(db, "series", body.seriesId))) return { ok: false, error: "that series doesn't exist" };
    seriesId = body.seriesId;
  }

  let position: number | null = null;
  if (body.seriesPosition !== undefined && body.seriesPosition !== null && body.seriesPosition !== "") {
    // Whole numbers and halves (2, 2.5, 3.5). Anything else is rejected.
    const n = Number(body.seriesPosition);
    if (!Number.isFinite(n) || n < 0 || n > 9999 || (n * 2) % 1 !== 0) {
      return { ok: false, error: "book number must be a whole number or a half, like 2 or 2.5" };
    }
    position = n;
  }
  return { ok: true, value: { title, author, seriesId, position } };
}

async function parseQuote(db: D1Database, body: Body): Promise<Parsed<{ bookId: string; text: string; page: string | null; attribution: string | null }>> {
  const bookId = requiredText(body.bookId, 100);
  if (!bookId) return { ok: false, error: "choose a book" };
  if (!(await rowExists(db, "books", bookId))) return { ok: false, error: "that book doesn't exist" };

  // Line breaks in the text are kept as typed.
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return { ok: false, error: "quote text is required" };
  if (text.length > MAX_QUOTE) return { ok: false, error: `quote is too long (max ${MAX_QUOTE} characters)` };

  const page = optionalText(body.page, 20);
  const attribution = optionalText(body.attribution, MAX_SHORT);
  if (page === undefined) return { ok: false, error: "page is too long" };
  if (attribution === undefined) return { ok: false, error: "attribution is too long" };
  return { ok: true, value: { bookId, text, page, attribution } };
}

async function seriesNameTaken(db: D1Database, name: string, exceptId: string | null): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM series WHERE name = ? COLLATE NOCASE AND id IS NOT ?")
    .bind(name, exceptId)
    .first();
  return !!row;
}

// ---- Create ----

export async function createSeries(db: D1Database, body: Body): Promise<Result> {
  const parsed = parseSeriesName(body);
  if (!parsed.ok) return fail(parsed.error);
  if (await seriesNameTaken(db, parsed.value, null)) return fail("a series with that name already exists", 409);

  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO series (id, name) VALUES (?, ?)").bind(id, parsed.value).run();
  return { status: 201, body: { ok: true, id, name: parsed.value } };
}

export async function createBook(db: D1Database, body: Body): Promise<Result> {
  const parsed = await parseBook(db, body);
  if (!parsed.ok) return fail(parsed.error);
  const { title, author, seriesId, position } = parsed.value;

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO books (id, title, author, series_id, series_position) VALUES (?, ?, ?, ?, ?)")
    .bind(id, title, author, seriesId, position)
    .run();
  return { status: 201, body: { ok: true, id, title } };
}

export async function createQuote(db: D1Database, body: Body): Promise<Result> {
  const parsed = await parseQuote(db, body);
  if (!parsed.ok) return fail(parsed.error);
  const { bookId, text, page, attribution } = parsed.value;

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO quotes (id, book_id, text, page, attribution, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, bookId, text, page, attribution, new Date().toISOString())
    .run();
  return { status: 201, body: { ok: true, id } };
}

// ---- Edit (full replacement of the editable fields) ----

export async function updateSeries(db: D1Database, id: string, body: Body): Promise<Result> {
  if (!(await rowExists(db, "series", id))) return NOT_FOUND();
  const parsed = parseSeriesName(body);
  if (!parsed.ok) return fail(parsed.error);
  if (await seriesNameTaken(db, parsed.value, id)) return fail("a series with that name already exists", 409);

  await db.prepare("UPDATE series SET name = ? WHERE id = ?").bind(parsed.value, id).run();
  return { status: 200, body: { ok: true } };
}

export async function updateBook(db: D1Database, id: string, body: Body): Promise<Result> {
  if (!(await rowExists(db, "books", id))) return NOT_FOUND();
  const parsed = await parseBook(db, body);
  if (!parsed.ok) return fail(parsed.error);
  const { title, author, seriesId, position } = parsed.value;

  await db
    .prepare("UPDATE books SET title = ?, author = ?, series_id = ?, series_position = ? WHERE id = ?")
    .bind(title, author, seriesId, position, id)
    .run();
  return { status: 200, body: { ok: true } };
}

export async function updateQuote(db: D1Database, id: string, body: Body): Promise<Result> {
  if (!(await rowExists(db, "quotes", id))) return NOT_FOUND();
  const parsed = await parseQuote(db, body);
  if (!parsed.ok) return fail(parsed.error);
  const { bookId, text, page, attribution } = parsed.value;

  await db
    .prepare("UPDATE quotes SET book_id = ?, text = ?, page = ?, attribution = ? WHERE id = ?")
    .bind(bookId, text, page, attribution, id)
    .run();
  return { status: 200, body: { ok: true } };
}

// ---- Delete ----

export async function deleteQuote(db: D1Database, id: string): Promise<Result> {
  const res = await db.prepare("DELETE FROM quotes WHERE id = ?").bind(id).run();
  return res.meta.changes > 0 ? { status: 200, body: { ok: true } } : NOT_FOUND();
}

// Refuses to delete a book that still has quotes, so deleting one can't remove
// quotes by accident. Delete its quotes first.
export async function deleteBook(db: D1Database, id: string): Promise<Result> {
  if (!(await rowExists(db, "books", id))) return NOT_FOUND();
  const count = await db.prepare("SELECT COUNT(*) AS n FROM quotes WHERE book_id = ?").bind(id).first<{ n: number }>();
  if (count && count.n > 0) {
    return fail(`this book still has ${count.n} quote${count.n === 1 ? "" : "s"}; delete them first`, 409);
  }
  await db.prepare("DELETE FROM books WHERE id = ?").bind(id).run();
  return { status: 200, body: { ok: true } };
}

// Deleting a series keeps its books; they become standalone.
export async function deleteSeries(db: D1Database, id: string): Promise<Result> {
  if (!(await rowExists(db, "series", id))) return NOT_FOUND();
  await db.batch([
    db.prepare("UPDATE books SET series_id = NULL, series_position = NULL WHERE series_id = ?").bind(id),
    db.prepare("DELETE FROM series WHERE id = ?").bind(id),
  ]);
  return { status: 200, body: { ok: true } };
}

// ---- Read ----

export async function listSeries(db: D1Database): Promise<Result> {
  const { results } = await db.prepare("SELECT id, name FROM series ORDER BY name").all();
  return { status: 200, body: { series: results } };
}

export async function getStats(db: D1Database): Promise<Result> {
  const totals = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM quotes) AS quotes,
              (SELECT COUNT(*) FROM books) AS books,
              (SELECT COUNT(*) FROM books WHERE id IN (SELECT book_id FROM quotes)) AS booksWithQuotes,
              (SELECT COUNT(*) FROM series) AS series,
              (SELECT COUNT(DISTINCT author) FROM books) AS authors,
              (SELECT MAX(created_at) FROM quotes) AS lastAdded`,
    )
    .first();

  const bySeries = await db
    .prepare(
      `SELECT COALESCE(s.name, 'Standalone') AS name, COUNT(q.id) AS quotes
         FROM quotes q
         JOIN books b ON b.id = q.book_id
         LEFT JOIN series s ON s.id = b.series_id
        GROUP BY name
        ORDER BY quotes DESC, name`,
    )
    .all();

  const byBook = await db
    .prepare(
      `SELECT b.title, COALESCE(s.name, '') AS series, COUNT(q.id) AS quotes
         FROM books b
         LEFT JOIN quotes q ON q.book_id = b.id
         LEFT JOIN series s ON s.id = b.series_id
        GROUP BY b.id
        ORDER BY quotes DESC, b.title
        LIMIT 50`,
    )
    .all();

  return { status: 200, body: { totals, bySeries: bySeries.results, byBook: byBook.results } };
}
