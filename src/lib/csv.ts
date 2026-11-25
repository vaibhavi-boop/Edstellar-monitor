/**
 * CSV helpers. Cells are always quoted; values that a spreadsheet would treat
 * as a formula (=, +, -, @, tab, CR at the start) get a leading apostrophe, so
 * a crawled page title cannot run a formula when someone opens the export.
 */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

/**
 * Streams a CSV in batches: `next(cursor)` returns rows after the cursor and
 * the cursor for the following batch (null when done). Memory stays flat
 * however large the export is.
 */
export function streamCsv<C>(
  filename: string,
  header: string[],
  first: C,
  next: (cursor: C) => Promise<{ rows: unknown[][]; cursor: C | null }>,
): Response {
  const encoder = new TextEncoder();
  let cursor: C | null = first;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`﻿${csvRow(header)}`));
    },
    async pull(controller) {
      if (cursor === null) return controller.close();
      try {
        const batch = await next(cursor);
        if (batch.rows.length) controller.enqueue(encoder.encode(batch.rows.map(csvRow).join("")));
        cursor = batch.cursor;
        if (cursor === null) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
