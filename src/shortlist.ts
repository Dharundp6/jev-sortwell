/**
 * The daily "what matters" shortlist.
 *
 * One `score` question per open item, batched so the whole list is ranked in
 * a handful of requests. Jev orders; code cuts. Ordering is the safe use of
 * a probability: being ranked third instead of second costs nothing, which
 * is not true of being deleted.
 */
import { score } from "./jev.js";
import { openBuckets, openItems, staleBuckets } from "./store.js";
import type { Asker, Bucket, Item, JevQuestion, Ranked } from "./types.js";

/** Items per request. Keeps state plus questions inside Jev's request limit. */
export const BATCH = 20;

const RUBRIC = [
  "nothing today: it is filed, it can wait, and no one is held up",
  "soon: worth doing this week, but nothing goes wrong today",
  "today: it is due, someone is waiting on it, or it blocks other work",
  "overdue: it should already have happened, and the cost of leaving it is rising",
];

export function stateFor(items: readonly Item[], buckets: readonly Bucket[], today: string): string {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const lines = [
    `TODAY IS ${today}.`,
    `The user wants the few things that actually matter today, out of everything still open.`,
    ``,
    `OPEN ITEMS:`,
  ];
  for (const i of items) {
    const b = i.bucket ? byId.get(i.bucket) : undefined;
    lines.push(
      ``,
      `ITEM ${i.id}`,
      `  captured ${i.at.slice(0, 10)} from ${i.source}, as a ${i.kind}, marked ${i.action}`,
      `  project: ${b ? `${b.name} (${b.scope})` : "none, still in the inbox"}`,
      `  ${i.text.replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }
  return lines.join("\n");
}

export function questionsFor(items: readonly Item[]): Record<string, JevQuestion> {
  return Object.fromEntries(
    items.map((i) => [
      `i_${i.id}`,
      {
        type: "score",
        instructions: `How much does item ${i.id} matter today?`,
        criteria: RUBRIC,
      } satisfies JevQuestion,
    ]),
  );
}

export interface Shortlist {
  ranked: Ranked[];
  /** Projects that have gone quiet without being closed. */
  stale: { bucket: Bucket; lastSeen: string | null }[];
  /** Set when ranking did not happen, saying why. The list is then unsorted. */
  note?: string;
  ms: number;
}

export async function shortlist(
  asker: Asker | null,
  options: { limit?: number; today?: string } = {},
  env?: NodeJS.ProcessEnv,
): Promise<Shortlist> {
  const t0 = Date.now();
  const items = openItems(env);
  const buckets = openBuckets(env);
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const bucketOf = (i: Item): Bucket | null => (i.bucket ? (byId.get(i.bucket) ?? null) : null);
  const stale = staleBuckets(21, env);
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  // Falling open: an unranked list in capture order beats no list at all.
  const unranked = (note: string): Shortlist => ({
    ranked: items.map((item) => ({ item, weight: Number.NaN, bucket: bucketOf(item) })),
    stale,
    note,
    ms: Date.now() - t0,
  });

  if (items.length === 0) return { ranked: [], stale, ms: Date.now() - t0 };
  if (!asker) return unranked("unranked: no TYPESAFE_API_KEY, so everything open is listed in capture order");

  const weights = new Map<string, number>();
  try {
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const res = await asker.ask(stateFor(batch, buckets, today), questionsFor(batch));
      for (const item of batch) {
        const w = score(res, `i_${item.id}`);
        if (w !== null) weights.set(item.id, w);
      }
    }
  } catch (err) {
    return unranked(`unranked: ${err instanceof Error ? err.message : String(err)}`);
  }

  const ranked = items
    .map((item) => ({ item, weight: weights.get(item.id) ?? 0, bucket: bucketOf(item) }))
    .sort((a, b) => b.weight - a.weight);

  return {
    ranked: options.limit ? ranked.slice(0, options.limit) : ranked,
    stale,
    ms: Date.now() - t0,
  };
}
