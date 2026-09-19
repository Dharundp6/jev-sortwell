/**
 * Storage. Two append-only JSONL files, buckets and items.
 *
 * Nothing is rewritten and nothing is deleted. State changes (an item marked
 * done, a bucket closed) are appended as a new version of the record, and the
 * latest one wins. A damaged line is skipped and counted, never removed, so a
 * crash mid-write cannot take the whole file with it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Bucket, Item, Kind, Action } from "./types.js";

export function storeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SORTWELL_DIR ?? join(homedir(), ".sortwell");
}
export const itemsPath = (env?: NodeJS.ProcessEnv): string => join(storeDir(env), "items.jsonl");
export const bucketsPath = (env?: NodeJS.ProcessEnv): string => join(storeDir(env), "buckets.jsonl");

export const newId = (): string => randomBytes(4).toString("hex");

function readLines<T>(path: string): { rows: T[]; unreadable: number } {
  if (!existsSync(path)) return { rows: [], unreadable: 0 };
  const rows: T[] = [];
  let unreadable = 0;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { id?: unknown };
      if (typeof parsed.id === "string") rows.push(parsed as T);
      else unreadable++;
    } catch {
      unreadable++;
    }
  }
  return { rows, unreadable };
}

function append(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}

/** Later records with the same id replace earlier ones. */
function latest<T extends { id: string }>(rows: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

// ---------------------------------------------------------------- buckets

export function readBuckets(env?: NodeJS.ProcessEnv): Bucket[] {
  return latest(readLines<Bucket>(bucketsPath(env)).rows);
}

/** Buckets an item can be routed to. A closed one is not a candidate. */
export function openBuckets(env?: NodeJS.ProcessEnv): Bucket[] {
  return readBuckets(env).filter((b) => !b.closedAt);
}

export function addBucket(
  input: { name: string; shelf: Bucket["shelf"]; scope: string },
  env?: NodeJS.ProcessEnv,
): Bucket {
  if (!input.name.trim()) throw new Error("a bucket needs a name");
  if (!input.scope.trim()) throw new Error("a bucket needs a scope: one line saying what belongs in it");
  const bucket: Bucket = {
    id: newId(),
    name: input.name.trim(),
    shelf: input.shelf,
    scope: input.scope.trim(),
  };
  append(bucketsPath(env), bucket);
  return bucket;
}

export function closeBucket(id: string, env?: NodeJS.ProcessEnv): Bucket {
  const bucket = readBuckets(env).find((b) => b.id === id);
  if (!bucket) throw new Error(`no bucket ${id}`);
  const closed: Bucket = { ...bucket, closedAt: new Date().toISOString() };
  append(bucketsPath(env), closed);
  return closed;
}

// ------------------------------------------------------------------ items

export function readItems(env?: NodeJS.ProcessEnv): Item[] {
  return latest(readLines<Item>(itemsPath(env)).rows);
}

export function unreadableLines(env?: NodeJS.ProcessEnv): number {
  return readLines<Item>(itemsPath(env)).unreadable + readLines<Bucket>(bucketsPath(env)).unreadable;
}

export function addItem(
  input: {
    text: string;
    source: string;
    kind: Kind;
    action: Action;
    bucket: string | null;
    confidence: number;
    duplicateOf?: string | undefined;
  },
  env?: NodeJS.ProcessEnv,
): Item {
  const item: Item = {
    id: newId(),
    text: input.text.trim(),
    source: input.source.trim() || "note",
    kind: input.kind,
    action: input.action,
    bucket: input.bucket,
    confidence: input.confidence,
    at: new Date().toISOString(),
  };
  if (input.duplicateOf) item.duplicateOf = input.duplicateOf;
  append(itemsPath(env), item);
  return item;
}

export function markDone(id: string, env?: NodeJS.ProcessEnv): Item {
  const item = readItems(env).find((i) => i.id === id);
  if (!item) throw new Error(`no item ${id}`);
  const done: Item = { ...item, doneAt: new Date().toISOString() };
  append(itemsPath(env), done);
  return done;
}

/** Items still wanting something: not done, not ignored, not a duplicate. */
export function openItems(env?: NodeJS.ProcessEnv): Item[] {
  return readItems(env).filter(
    (i) => !i.doneAt && i.kind !== "ignore" && !i.duplicateOf && i.action !== "none",
  );
}

/**
 * Projects with no item captured in `days`, which is the signal that a
 * project has gone quiet without being closed. Areas never go stale; they
 * are ongoing by definition.
 */
export function staleBuckets(days = 21, env?: NodeJS.ProcessEnv): { bucket: Bucket; lastSeen: string | null }[] {
  const items = readItems(env);
  const cutoff = Date.now() - days * 86_400_000;
  const out: { bucket: Bucket; lastSeen: string | null }[] = [];
  for (const bucket of openBuckets(env)) {
    if (bucket.shelf !== "project") continue;
    const mine = items.filter((i) => i.bucket === bucket.id).map((i) => i.at).sort();
    const lastSeen = mine.length > 0 ? mine[mine.length - 1]! : null;
    if (!lastSeen || Date.parse(lastSeen) < cutoff) out.push({ bucket, lastSeen });
  }
  return out;
}
