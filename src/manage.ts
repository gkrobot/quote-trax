// Create endpoints and stats. Each function returns a status and body so the
// router in index.ts can turn it into a response.

export type Result = { status: number; body: unknown };

const MAX_QUOTE = 20000;
const MAX_TITLE = 300;
const MAX_NAME = 120;
const MAX_SHORT = 300;

function bad(error: string): Result {
  return { status: 400, body: { error } };
}

// Required, trimmed string within a length limit.
function requiredText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

// Optional string: empty or missing becomes null.
function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length <= max ? t || null : undefined;
}

type Body = Record<string, unknown>;

export async function createSeries(db: D1Database, body: Body): Promise<Result> {
  const name = requiredText(body.name, MAX_NAME);
  if (!name) return bad(`series name is required (up to ${MAX_NAME} characters)`);

  const existing = await db.prepare("SELECT id FROM series WHERE name = ? COLLATE NOCASE").bind(name).first();
  if (existing) return { status: 409, body: { error: "a series with that name already exists" } };

  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO series (id, name) VALUES (?, ?)").bind(id, name).run();
  return { status: 201, body: { ok: true, id, name } };
}

export async function createBook(db: D1Database, body: Body): Promise<Result> {
  const title = requiredText(body.title, MAX_TITLE);
  if (!title) return bad(`book title is required (up to ${MAX_TITLE} characters)`);
  const author = requiredText(body.author, MAX_SHORT);
  if (!author) return bad("author is required");

  let seriesId: string | null = null;
  if (body.seriesId !== undefined && body.seriesId !== null && body.seriesId !== "") {
    if (typeof body.seriesId !== "string") return bad("invalid series");
    const exists = await db.prepare("SELECT id FROM series WHERE id = ?").bind(body.seriesId).first();
    if (!exists) return bad("that series doesn't exist");
    seriesId = body.seriesId;
  }

  let position: number | null = null;
  if (body.seriesPosition !== undefined && body.seriesPosition !== null && body.seriesPosition !== "") {
    const n = Number(body.seriesPosition);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return bad("series position must be a whole number");
    position = n;
  }

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO books (id, title, author, series_id, series_position) VALUES (?, ?, ?, ?, ?)")
    .bind(id, title, author, seriesId, position)
    .run();
  return { status: 201, body: { ok: true, id, title } };
}

export async function createQuote(db: D1Database, body: Body): Promise<Result> {
  const bookId = requiredText(body.bookId, 100);
  if (!bookId) return bad("choose a book");
  const exists = await db.prepare("SELECT id FROM books WHERE id = ?").bind(bookId).first();
  if (!exists) return bad("that book doesn't exist");

  // Line breaks in the text are kept as typed.
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return bad("quote text is required");
  if (text.length > MAX_QUOTE) return bad(`quote is too long (max ${MAX_QUOTE} characters)`);

  const page = optionalText(body.page, 20);
  const attribution = optionalText(body.attribution, MAX_SHORT);
  if (page === undefined) return bad("page is too long");
  if (attribution === undefined) return bad("attribution is too long");

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO quotes (id, book_id, text, page, attribution, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, bookId, text, page, attribution, new Date().toISOString())
    .run();
  return { status: 201, body: { ok: true, id } };
}

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
