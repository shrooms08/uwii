/**
 * Signed classification runs kept in this browser (IndexedDB, memory if IndexedDB is unavailable).
 * /api/scan returns { run, runSig }; every questions/report/anchor request sends them back, so any
 * server instance can build the report and no other user can change it. Runs hold public on-chain
 * data and the AI's labels; answers and personal fields stay in localStorage (storage.ts).
 */
import type { ClassifiedRun } from "@/lib/tax/ng/types";

export interface SignedRun {
  run: ClassifiedRun;
  runSig: string;
}

const DB_NAME = "uwii";
const STORE = "runs";
const memory = new Map<string, SignedRun>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const r = run(t.objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveRun(account: string, signed: SignedRun): Promise<void> {
  memory.set(account, signed);
  const db = await openDb();
  if (!db) return;
  await tx(db, "readwrite", (s) => s.put(signed, account));
  db.close();
}

export async function loadRun(account: string): Promise<SignedRun | null> {
  const hit = memory.get(account);
  if (hit) return hit;
  const db = await openDb();
  if (!db) return null;
  const v = (await tx<SignedRun | undefined>(db, "readonly", (s) => s.get(account))) ?? null;
  db.close();
  if (v && v.run && typeof v.runSig === "string") {
    memory.set(account, v);
    return v;
  }
  return null;
}

/** Removes every saved run (memory and IndexedDB). */
export async function clearRuns(): Promise<void> {
  memory.clear();
  await new Promise<void>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve();
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
