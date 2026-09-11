import Papa from "papaparse";
import { MAX_ROWS, MAX_IMPORT_ROWS, MAX_CSV_UPLOAD } from "./model";
import { looksLikeHeader } from "./columns";
import { isVerificationVariable } from "./verification-code";
export async function parseAttendeeFile(file: File, onProgress?: (progress: { percent: number; rowsRead: number }) => void) {
  const csv = /\.csv$/i.test(file.name);
  const rowLimit = csv ? MAX_IMPORT_ROWS : MAX_ROWS;
  if (file.size > (csv ? MAX_CSV_UPLOAD : 8 * 1024 * 1024)) throw new Error(csv ? "CSV files must be at most 50 MB. Split larger files before importing." : "XLSX files must be at most 8 MB. Export large spreadsheets as CSV (up to 50 MB / 50,000 attendees).");
  let matrix: string[][];
  if (/\.csv$/i.test(file.name)) {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const directive = /^sep=(.)\r?\n/i.exec(text);
    const content = directive ? text.slice(directive[0].length) : text;
    matrix = [];
    let parseError: Error | undefined;
    // Parsing runs in the browser worker. Bounded chunks let us report progress
    // and abort oversized imports before constructing the remaining row objects.
    const config: Papa.ParseConfig<string[]> & Pick<Papa.ParseLocalConfig<string[]>, "chunkSize" | "chunk"> = {
      skipEmptyLines: "greedy", chunkSize: 256 * 1024, ...(directive ? { delimiter: directive[1] } : {}),
      chunk(result, parser) {
        if (result.errors.length) parseError = new Error(`CSV error: ${result.errors[0].message}`);
        for (const cells of result.data) {
          if (parseError) break;
          if (cells.some(c => c.length > 2000)) { parseError = new Error(`CSV record ${matrix.length + 1} has a cell longer than 2,000 characters.`); break; }
          matrix.push(cells);
          if (matrix.length > rowLimit + 10) { parseError = new Error("CSV exceeds 50,000 attendee rows. Split it into smaller files."); break; }
        }
        if (parseError) { parser.abort(); return; }
        onProgress?.({ percent: Math.min(99, Math.floor(result.meta.cursor / Math.max(1, content.length) * 100)), rowsRead: Math.max(0, matrix.length - 1) });
      },
    };
    Papa.parse<string[]>(content, config);
    if (parseError) throw parseError;
  } else if (/\.xlsx$/i.test(file.name)) {
    const excel = await import("exceljs");
    const Workbook = excel.Workbook || excel.default.Workbook;
    const workbook = new Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0]; if (!sheet) throw new Error("Spreadsheet has no worksheet");
    const cellText = (value: unknown): string => {
      if (value == null) return "";
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      if (typeof value === "object") {
        const v = value as { text?: string; result?: unknown; richText?: { text: string }[] };
        return v.richText ? v.richText.map(t => t.text).join("") : v.text ?? (v.result !== undefined ? cellText(v.result) : "");
      }
      return String(value);
    };
    matrix = [];
    sheet.eachRow(row => {
      const cells: string[] = [];
      row.eachCell(cell => { const text = cellText(cell.value); if (text.trim()) cells[Number(cell.col) - 1] = text; });
      if (cells.length) matrix.push(cells);
      if (matrix.length > MAX_ROWS + 11) throw new Error("Spreadsheet exceeds 2,000 attendee rows");
    });
  } else throw new Error("Choose a CSV or XLSX file. Export older XLS files as CSV first.");
  const warnings: string[] = [];
  // Ignore fully empty spreadsheet columns, including formatted cells far to
  // the right of the table. Preserve populated columns even without a heading.
  const used = new Set<number>();
  matrix.forEach(cells => cells.forEach((cell, i) => { if (cell?.trim()) used.add(i); }));
  const columns = [...used].sort((a, b) => a - b);
  if (!columns.length || columns.length > 50) throw new Error("Use between 1 and 50 populated columns");
  matrix.forEach((cells, index) => { matrix[index] = columns.map(i => cells[i] || ""); });
  const first = matrix[0] || [];
  if (!first.some(looksLikeHeader)) {
    const headerRow = matrix.slice(1, 10).findIndex(cells => cells.filter(looksLikeHeader).length >= 2);
    if (headerRow >= 0) { matrix = matrix.slice(headerRow + 1); warnings.push(`Skipped ${headerRow + 1} title row(s) above the column headers.`); }
  }
  const seen = new Set<string>();
  const headers = (matrix.shift() || []).map((raw, i) => {
    const clean = raw.replace(/^\uFEFF/, "").trim();
    const base = (!clean || isVerificationVariable(clean.replace(/[{}]/g, "")) || ["__proto__", "constructor", "prototype"].includes(clean) ? `Column ${columns[i] + 1}` : clean.replace(/[{}]/g, "")).slice(0, 90) || `Column ${columns[i] + 1}`;
    let header = base, suffix = 2;
    while (seen.has(header.toLowerCase())) header = `${base} (${suffix++})`;
    seen.add(header.toLowerCase());
    if (header !== clean) warnings.push(`Column ${columns[i] + 1} is named “${header}” so it can be used as a variable.`);
    return header;
  });
  matrix = matrix.filter(cells => cells.some(cell => cell.trim()));
  if (!matrix.length || matrix.length > rowLimit) throw new Error(`Import between 1 and ${rowLimit.toLocaleString("en-US")} attendee rows.${csv ? " Split larger lists into separate files." : " Export larger spreadsheets as CSV."}`);
  const rows = matrix.map((cells, i) => {
    if (cells.length > headers.length || cells.some(c => c.length > 2000)) throw new Error(`Row ${i + 1} has too many columns or an oversized cell`);
    return { values: Object.fromEntries(headers.map((h, j) => [h, cells[j] || ""])), overrides: {} };
  });
  onProgress?.({ percent: 100, rowsRead: rows.length });
  return { headers, rows, warnings, fileName: file.name };
}
