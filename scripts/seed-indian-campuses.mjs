import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(process.cwd(), ".data", "campuses.json");
if (!inputPath) throw new Error("Usage: npm run seed:campuses -- <aishe.csv|json> [output.json]");

const raw = await readFile(inputPath, "utf8");
const rows = inputPath.toLowerCase().endsWith(".json")
  ? JSON.parse(raw)
  : parse(raw, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true });
const records = Array.isArray(rows) ? rows : rows.records || rows.data || [];

function value(record, candidates) {
  const entries = Object.entries(record).map(([key, item]) => [key.toLowerCase().replace(/[^a-z0-9]+/g, "_"), String(item || "").trim()]);
  for (const candidate of candidates) {
    const match = entries.find(([key]) => key === candidate || key.endsWith(`_${candidate}`));
    if (match?.[1]) return match[1];
  }
  return "";
}

const seen = new Set();
const campuses = records.flatMap((record, index) => {
  const name = value(record, ["institution_name", "college_name", "university_name", "institute_name", "name"]);
  if (!name) return [];
  const city = value(record, ["city", "district", "town"]);
  const state = value(record, ["state_name", "state"]);
  const type = value(record, ["institution_type", "college_type", "university_type", "type"]) || "Higher Education Institution";
  const code = value(record, ["aishe_code", "institution_code", "college_code", "university_code", "code"]);
  const dedupeKey = `${name}|${city}|${state}`.toLowerCase();
  if (seen.has(dedupeKey)) return [];
  seen.add(dedupeKey);
  return [{ id: code || `AISHE-${String(index + 1).padStart(6, "0")}`, name, city, state, type }];
});

campuses.sort((a, b) => a.name.localeCompare(b.name) || a.city.localeCompare(b.city));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({ version: 1, source: path.basename(inputPath), generatedAt: new Date().toISOString(), campuses }, null, 2), "utf8");
console.log(`Seeded ${campuses.length} Indian campuses into ${outputPath}`);
