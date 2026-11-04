import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const CACHE_DIR = path.join(process.cwd(), "data", "cache");
export const FIXTURE_DIR = path.join(process.cwd(), "data", "fixtures");

export async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Atomic JSON write (temp file + rename). */
export async function writeJson(file: string, value: unknown, pretty = true): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
  await rename(tmp, file);
}
