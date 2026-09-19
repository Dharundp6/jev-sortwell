/**
 * Capture: the one decision that matters.
 *
 * Four questions in a single Jev request, answered in parallel and in
 * isolation: what kind of thing is this, which bucket does it belong to,
 * what does it need from you, and have you already got it. One round trip,
 * about 400ms, a fraction of a penny.
 *
 * Jev decides. This module stores. Nothing here writes prose, and the item's
 * own text is saved exactly as it arrived.
 */
import { choice, noul } from "./jev.js";
import { addItem, openBuckets, readItems } from "./store.js";
import {
  ACTIONS,
  KINDS,
  type Action,
  type Asker,
  type Bucket,
  type Capture,
  type Item,
  type JevQuestion,
  type Kind,
} from "./types.js";

/** Above this, the item is filed as a duplicate of the nearest match. */
export const DUPLICATE_AT = 0.7;
/** Below this on the routing choice, nothing fitted and it goes to the inbox. */
export const ROUTE_AT = 0.45;
/** How many recent items are offered as duplicate candidates. */
export const NEAREST_POOL = 40;

const KIND_CRITERIA: Record<Kind, string> = {
  task: "something that has to be done, by the user or by someone on their behalf",
  decision: "a choice that has been settled, and is worth being able to look up later",
  "project-update": "news about how a piece of ongoing work is going, changing what the user believes about its state",
  reference: "information worth keeping to consult later, which asks nothing of the user now",
  "personal-follow-up": "something owed to or from another person: a reply, an introduction, a promise made",
  ignore: "noise: a pleasantry, a duplicate of something obvious, or something with no lasting value",
};

const ACTION_CRITERIA: Record<Action, string> = {
  now: "needs attention within a day or two, or it causes a problem",
  scheduled: "needs attention, but at a known later time or after something else happens",
  "read-later": "worth the user's own attention when they have time, and nothing breaks if they never get to it",
  none: "wants nothing; it is filed so it can be found again",
};

/** A short, stable fingerprint of an item for the duplicate question. */
function brief(item: Item): string {
  const t = item.text.replace(/\s+/g, " ").trim();
  return `${item.id}: ${t.length > 160 ? `${t.slice(0, 157)}...` : t}`;
}

/**
 * Cheap pre-filter for the duplicate check: the most recent items, most
 * recent first. Jev is asked about the single nearest one rather than all of
 * them, because a per-item question would cost a request per capture.
 */
export function candidates(items: readonly Item[], limit = NEAREST_POOL): Item[] {
  return [...items]
    .filter((i) => !i.duplicateOf)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export function buildState(text: string, source: string, buckets: readonly Bucket[], pool: readonly Item[]): string {
  const lines = [
    `A NEW ITEM HAS JUST BEEN CAPTURED.`,
    `SOURCE: ${source}`,
    `TEXT:`,
    text.trim(),
    ``,
    `THE USER'S OPEN PROJECTS AND AREAS:`,
  ];
  if (buckets.length === 0) lines.push(`  (none yet)`);
  for (const b of buckets) lines.push(`  ${b.id} — ${b.name} (${b.shelf}): ${b.scope}`);
  lines.push(``, `ITEMS ALREADY CAPTURED, NEWEST FIRST:`);
  if (pool.length === 0) lines.push(`  (none yet)`);
  for (const i of pool) lines.push(`  ${brief(i)}`);
  return lines.join("\n");
}

export function buildQuestions(buckets: readonly Bucket[], pool: readonly Item[]): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {
    kind: {
      type: "choice",
      instructions: "What kind of thing is this new item? Judge the item itself, not the source it came from.",
      criteria: Object.fromEntries(KINDS.map((k) => [k, KIND_CRITERIA[k]])),
    },
    action: {
      type: "choice",
      instructions: "What does this new item need from the user next?",
      criteria: Object.fromEntries(ACTIONS.map((a) => [a, ACTION_CRITERIA[a]])),
    },
  };

  if (buckets.length > 0) {
    q.route = {
      type: "choice",
      instructions:
        "Which of the user's projects or areas does this new item belong to? Choose `none` when it does not clearly belong to any of them; a wrong home is worse than the inbox.",
      criteria: {
        ...Object.fromEntries(buckets.map((b) => [b.id, `${b.name}: ${b.scope}`])),
        none: "it does not clearly belong to any of them, and should sit in the inbox until the user says otherwise",
      },
    };
  }

  if (pool.length > 0) {
    q.duplicate = {
      type: "noul",
      instructions:
        "The user has already captured this same thing. One of the items listed above says substantially what this new item says, so saving it again would leave two records of one thing.",
      criteria: {
        true: "an existing item already records this same fact, task or decision, even if worded differently",
        false: "this is new, or it only touches the same topic as an existing item without repeating it",
      },
    };
    q.nearest = {
      type: "choice",
      instructions: "Which existing item is closest in meaning to the new one? Pick the single nearest, even if it is not close.",
      criteria: Object.fromEntries(pool.slice(0, 20).map((i) => [i.id, brief(i)])),
    };
  }

  return q;
}

export async function capture(
  input: { text: string; source?: string },
  asker: Asker,
  env?: NodeJS.ProcessEnv,
): Promise<Capture> {
  const text = input.text.trim();
  if (!text) throw new Error("nothing to capture");
  const source = (input.source ?? "note").trim() || "note";

  const buckets = openBuckets(env);
  const pool = candidates(readItems(env));
  const t0 = Date.now();
  const res = await asker.ask(buildState(text, source, buckets, pool), buildQuestions(buckets, pool));
  const ms = Date.now() - t0;

  const kindAnswer = choice(res, "kind");
  if (!kindAnswer || !KINDS.includes(kindAnswer.choice as Kind)) {
    throw new Error("Jev did not return a usable kind");
  }
  const kind = kindAnswer.choice as Kind;

  const actionAnswer = choice(res, "action");
  const action: Action =
    actionAnswer && ACTIONS.includes(actionAnswer.choice as Action)
      ? (actionAnswer.choice as Action)
      : "none";

  // Routing. `none`, an unknown id, or a weak pick all mean the inbox.
  let routedTo: Capture["routedTo"] = null;
  const routeAnswer = buckets.length > 0 ? choice(res, "route") : null;
  if (routeAnswer && routeAnswer.choice !== "none") {
    const bucket = buckets.find((b) => b.id === routeAnswer.choice);
    const p = routeAnswer.probabilities[routeAnswer.choice] ?? routeAnswer.confidence;
    if (bucket && p >= ROUTE_AT) routedTo = { bucket, confidence: p };
  }

  // Duplicates. Both questions must agree: it looks like a repeat, and there
  // is a specific item it repeats.
  const duplicateProbability = pool.length > 0 ? (noul(res, "duplicate") ?? 0) : 0;
  const nearestAnswer = pool.length > 0 ? choice(res, "nearest") : null;
  const nearest = nearestAnswer ? (pool.find((i) => i.id === nearestAnswer.choice) ?? null) : null;
  const duplicateOf = duplicateProbability >= DUPLICATE_AT && nearest ? nearest.id : undefined;

  const item = addItem(
    {
      text,
      source,
      kind,
      action: kind === "ignore" ? "none" : action,
      bucket: routedTo?.bucket.id ?? null,
      confidence: kindAnswer.confidence,
      duplicateOf,
    },
    env,
  );

  return {
    item,
    kindProbabilities: kindAnswer.probabilities,
    routedTo,
    duplicateProbability,
    nearest,
    ms,
  };
}
