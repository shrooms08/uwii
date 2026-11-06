import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** True on Vercel (read-only deployment filesystem; only the OS temp dir is writable). */
export const ON_VERCEL = Boolean(process.env.VERCEL);

/**
 * Runtime caches. Locally: data/cache (gitignored). On Vercel: <os.tmpdir()>/uwii-cache, which is
 * per-instance scratch space and may disappear between invocations; every cache is rebuildable.
 * UWII_CACHE_DIR overrides both.
 */
export const CACHE_DIR = process.env.UWII_CACHE_DIR?.trim() || (ON_VERCEL ? path.join(os.tmpdir(), "uwii-cache") : path.join(process.cwd(), "data", "cache"));
/** Committed fixtures: always read-only at runtime. */
export const FIXTURE_DIR = path.join(process.cwd(), "data", "fixtures");

export async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** On Vercel, refuse any write outside the OS temp dir (fixtures and the bundle are read-only). */
export function assertWritable(file: string): void {
  if (!ON_VERCEL) return;
  const tmp = path.resolve(os.tmpdir());
  const target = path.resolve(file);
  if (target !== tmp && !target.startsWith(tmp + path.sep)) {
    throw new Error(`Refusing to write ${path.relative(process.cwd(), target) || target}: only ${tmp} is writable on Vercel`);
  }
}

/** Atomic JSON write (temp file + rename). */
export async function writeJson(file: string, value: unknown, pretty = true): Promise<void> {
  assertWritable(file);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
  await rename(tmp, file);
}
