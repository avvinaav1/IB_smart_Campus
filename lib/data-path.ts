import path from "node:path";

export function dataPath(...segments: string[]) {
  const base = process.env.VERCEL ? "/tmp" : process.cwd();
  return path.join(base, ...segments);
}
