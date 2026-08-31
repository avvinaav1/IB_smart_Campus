import { readFile } from "node:fs/promises";
import path from "node:path";
import { starterIndianCampuses, type CampusRecord } from "@/lib/indian-campuses";

type CampusDatabase = { version: 1; source?: string; generatedAt?: string; campuses: CampusRecord[] };
const databasePath = process.env.CAMPUSES_DATA_FILE || path.join(process.cwd(), ".data", "campuses.json");
let databasePromise: Promise<CampusDatabase> | undefined;

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function loadDatabase() {
  if (!databasePromise) {
    databasePromise = readFile(/* turbopackIgnore: true */ databasePath, "utf8")
      .then((raw) => JSON.parse(raw) as CampusDatabase)
      .then((database) => ({ ...database, campuses: Array.isArray(database.campuses) ? database.campuses : [] }))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return { version: 1 as const, source: "starter", campuses: starterIndianCampuses };
        throw error;
      });
  }
  return databasePromise;
}

export async function searchIndianCampuses(query: string, limit = 20) {
  const database = await loadDatabase();
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return database.campuses
    .flatMap((campus) => {
      const name = normalize(campus.name);
      const aliases = normalize((campus.aliases || []).join(" "));
      const place = normalize(`${campus.city} ${campus.state} ${campus.type}`);
      const haystack = `${name} ${aliases} ${place}`;
      if (!tokens.every((token) => haystack.includes(token))) return [];
      const score = name === normalizedQuery ? 0 : name.startsWith(normalizedQuery) ? 1 : aliases.includes(normalizedQuery) ? 2 : name.includes(normalizedQuery) ? 3 : 4;
      return [{ campus, score }];
    })
    .sort((a, b) => a.score - b.score || a.campus.name.localeCompare(b.campus.name))
    .slice(0, Math.min(50, Math.max(1, limit)))
    .map(({ campus }) => campus);
}

export async function isKnownIndianCampus(name: string) {
  const database = await loadDatabase();
  const normalizedName = normalize(name);
  return Boolean(normalizedName && database.campuses.some((campus) => normalize(campus.name) === normalizedName));
}
