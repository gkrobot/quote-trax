import type { ExportFile } from "./import";

// Full library in the same shape the import reads, so an export can be pasted back in.
export async function exportLibrary(db: D1Database): Promise<ExportFile & { exportedAt: string }> {
  const books = await db
    .prepare(
      `SELECT b.id, b.title, b.author, b.series_position AS seriesPosition, s.name AS series
         FROM books b
         LEFT JOIN series s ON s.id = b.series_id
        ORDER BY s.name, b.series_position, b.title`,
    )
    .all();

  const quotes = await db
    .prepare(
      `SELECT id, text, book_id AS bookId, page, attribution, created_at AS added
         FROM quotes
        ORDER BY created_at`,
    )
    .all();

  return {
    exportedAt: new Date().toISOString(),
    books: books.results as ExportFile["books"],
    quotes: quotes.results as ExportFile["quotes"],
  };
}
