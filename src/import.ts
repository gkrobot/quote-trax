import { cleanQuote, cleanText, seriesId } from "./quote-clean";

// Format shared by export and import. Older exports omit the optional fields.
export type ExportBook = {
  id: string;
  title: string;
  author: string;
  series: string | null;
  seriesPosition?: number | null;
};
export type ExportQuote = {
  id: string;
  text: string;
  bookId: string;
  page: string | null;
  added: string;
  attribution?: string | null;
};
export type ExportFile = { books: ExportBook[]; quotes: ExportQuote[] };

export type ImportResult = { series: number; books: number; quotes: number; skipped: number };

// Re-running an import updates rows by ID. Quote text and attribution are
// overwritten by the file. Series positions are kept unless the file sets one.
export async function importExport(db: D1Database, data: unknown): Promise<ImportResult | string> {
  if (!isExportFile(data)) return "file is not a quote export (needs books and quotes arrays)";

  const statements: D1PreparedStatement[] = [];
  const seriesNames = new Map<string, string>();

  for (const b of data.books) {
    if (b.series && b.series.trim()) seriesNames.set(seriesId(b.series), b.series.trim());
  }
  for (const [id, name] of seriesNames) {
    statements.push(
      db
        .prepare("INSERT INTO series (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name")
        .bind(id, name),
    );
  }

  const bookIds = new Set<string>();
  for (const b of data.books) {
    bookIds.add(b.id);
    const sid = b.series && b.series.trim() ? seriesId(b.series) : null;
    const position = typeof b.seriesPosition === "number" ? b.seriesPosition : null;
    statements.push(
      db
        .prepare(
          `INSERT INTO books (id, title, author, series_id, series_position) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, author = excluded.author,
             series_id = excluded.series_id,
             series_position = COALESCE(excluded.series_position, books.series_position)`,
        )
        .bind(b.id, b.title, b.author, sid, position),
    );
  }

  let skipped = 0;
  let quoteCount = 0;
  for (const q of data.quotes) {
    if (!bookIds.has(q.bookId)) {
      skipped++;
      continue;
    }
    // If the file has an attribution field, use it as-is. Otherwise split one off the text.
    const parsed =
      typeof q.attribution === "string"
        ? { text: cleanText(q.id, q.text), attribution: q.attribution.trim() || null }
        : cleanQuote(q.id, q.text);
    const page = q.page && q.page.trim() ? q.page.trim() : null;
    statements.push(
      db
        .prepare(
          `INSERT INTO quotes (id, book_id, text, page, attribution, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET book_id = excluded.book_id, text = excluded.text,
             page = excluded.page, attribution = excluded.attribution`,
        )
        .bind(q.id, q.bookId, parsed.text, page, parsed.attribution, q.added),
    );
    quoteCount++;
  }

  await db.batch(statements);
  return { series: seriesNames.size, books: data.books.length, quotes: quoteCount, skipped };
}

function isExportFile(data: unknown): data is ExportFile {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    Array.isArray(d.books) &&
    Array.isArray(d.quotes) &&
    d.books.every((b) => b && typeof (b as ExportBook).id === "string" && typeof (b as ExportBook).title === "string") &&
    d.quotes.every((q) => q && typeof (q as ExportQuote).id === "string" && typeof (q as ExportQuote).text === "string")
  );
}
