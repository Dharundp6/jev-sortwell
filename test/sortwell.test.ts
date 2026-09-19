import { mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildQuestions, buildState, candidates, capture, DUPLICATE_AT, ROUTE_AT } from "../src/capture.js";
import { formatCapture, formatShortlist } from "../src/format.js";
import { choice, noul, score } from "../src/jev.js";
import { shortlist, BATCH } from "../src/shortlist.js";
import {
  addBucket, addItem, closeBucket, itemsPath, markDone, openBuckets, openItems,
  readItems, staleBuckets, unreadableLines,
} from "../src/store.js";
import type { Asker, JevResponse } from "../src/types.js";

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sortwell-"));
  env = { ...process.env, SORTWELL_DIR: dir };
  process.env.SORTWELL_DIR = dir;
});
afterEach(() => {
  delete process.env.SORTWELL_DIR;
  rmSync(dir, { recursive: true, force: true });
});

/** A fake Jev. Answers exactly what it is told to, nothing else. */
const fake = (answers: JevResponse["answers"], seen?: { state?: string; keys?: string[] }): Asker => ({
  async ask(state, questions) {
    if (seen) {
      seen.state = state;
      seen.keys = Object.keys(questions);
    }
    return { answers };
  },
});

const kindAnswer = (c: string, p = 0.9) => ({
  choice: c,
  confidence: p,
  probabilities: { [c]: p, reference: 1 - p },
});

describe("store", () => {
  it("is append-only: marking done adds a line and keeps the original", () => {
    const i = addItem({ text: "a", source: "note", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    markDone(i.id, env);
    const lines = readFileSync(itemsPath(env), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).doneAt).toBeUndefined();
    expect(readItems(env)).toHaveLength(1);
    expect(readItems(env)[0]!.doneAt).toBeTruthy();
  });

  it("keeps done, ignored and duplicate items out of the open list", () => {
    const keep = addItem({ text: "keep", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    const done = addItem({ text: "done", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    markDone(done.id, env);
    addItem({ text: "noise", source: "n", kind: "ignore", action: "none", bucket: null, confidence: 1 }, env);
    addItem({ text: "dupe", source: "n", kind: "task", action: "now", bucket: null, confidence: 1, duplicateOf: keep.id }, env);
    addItem({ text: "filed", source: "n", kind: "reference", action: "none", bucket: null, confidence: 1 }, env);
    expect(openItems(env).map((i) => i.text)).toEqual(["keep"]);
  });

  it("a closed bucket stops being a routing candidate but stays on disk", () => {
    const b = addBucket({ name: "Ship it", shelf: "project", scope: "the launch" }, env);
    expect(openBuckets(env)).toHaveLength(1);
    closeBucket(b.id, env);
    expect(openBuckets(env)).toHaveLength(0);
    expect(readFileSync(join(dir, "buckets.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("requires a scope, because routing is judged against it", () => {
    expect(() => addBucket({ name: "X", shelf: "project", scope: "  " }, env)).toThrow(/scope/);
  });

  it("skips a damaged line instead of throwing, and counts it", () => {
    addItem({ text: "good", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    appendFileSync(itemsPath(env), '{"id":"bad","text":\n', "utf8");
    expect(readItems(env)).toHaveLength(1);
    expect(unreadableLines(env)).toBe(1);
  });

  it("calls a project stale when nothing has been captured into it, and never an area", () => {
    const old = addBucket({ name: "Quiet", shelf: "project", scope: "dormant work" }, env);
    addBucket({ name: "Health", shelf: "area", scope: "ongoing" }, env);
    const stale = staleBuckets(21, env);
    expect(stale.map((s) => s.bucket.id)).toEqual([old.id]);
    expect(stale[0]!.lastSeen).toBeNull();
  });
});

describe("capture", () => {
  it("files the kind and action Jev returns, verbatim text, and no bucket when there are none", async () => {
    const c = await capture(
      { text: "  Email the auditor the Q3 figures  ", source: "meeting" },
      fake({ kind: kindAnswer("task"), action: kindAnswer("now", 0.8) }),
      env,
    );
    expect(c.item.kind).toBe("task");
    expect(c.item.action).toBe("now");
    expect(c.item.text).toBe("Email the auditor the Q3 figures");
    expect(c.item.source).toBe("meeting");
    expect(c.item.bucket).toBeNull();
    expect(readItems(env)).toHaveLength(1);
  });

  it("routes to a bucket when the pick is confident enough", async () => {
    const b = addBucket({ name: "Warehouse", shelf: "project", scope: "the rollout" }, env);
    const c = await capture(
      { text: "the loader now retries" },
      fake({
        kind: kindAnswer("project-update"),
        action: kindAnswer("none", 0.7),
        route: { choice: b.id, confidence: 0.9, probabilities: { [b.id]: 0.9, none: 0.1 } },
      }),
      env,
    );
    expect(c.routedTo?.bucket.id).toBe(b.id);
    expect(c.item.bucket).toBe(b.id);
  });

  it("leaves it in the inbox when routing is weak, because a wrong home is worse", async () => {
    const b = addBucket({ name: "Warehouse", shelf: "project", scope: "the rollout" }, env);
    const weak = ROUTE_AT - 0.05;
    const c = await capture(
      { text: "something vague" },
      fake({
        kind: kindAnswer("reference"),
        action: kindAnswer("none"),
        route: { choice: b.id, confidence: weak, probabilities: { [b.id]: weak, none: 1 - weak } },
      }),
      env,
    );
    expect(c.routedTo).toBeNull();
    expect(c.item.bucket).toBeNull();
  });

  it("leaves it in the inbox when Jev picks none", async () => {
    const b = addBucket({ name: "Warehouse", shelf: "project", scope: "the rollout" }, env);
    const c = await capture(
      { text: "unrelated" },
      fake({
        kind: kindAnswer("reference"),
        action: kindAnswer("none"),
        route: { choice: "none", confidence: 0.95, probabilities: { none: 0.95, [b.id]: 0.05 } },
      }),
      env,
    );
    expect(c.item.bucket).toBeNull();
  });

  it("marks a duplicate only when both the probability and a nearest item agree", async () => {
    const first = addItem({ text: "call the auditor", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    const dup = await capture(
      { text: "ring the auditor" },
      fake({
        kind: kindAnswer("task"),
        action: kindAnswer("now"),
        duplicate: { noul: DUPLICATE_AT + 0.1 },
        nearest: { choice: first.id, confidence: 0.9, probabilities: { [first.id]: 0.9 } },
      }),
      env,
    );
    expect(dup.item.duplicateOf).toBe(first.id);
    expect(openItems(env).map((i) => i.text)).toEqual(["call the auditor"]);
  });

  it("does not mark a duplicate when the probability is below the threshold", async () => {
    const first = addItem({ text: "call the auditor", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    const c = await capture(
      { text: "book the audit room" },
      fake({
        kind: kindAnswer("task"),
        action: kindAnswer("now"),
        duplicate: { noul: DUPLICATE_AT - 0.2 },
        nearest: { choice: first.id, confidence: 0.6, probabilities: { [first.id]: 0.6 } },
      }),
      env,
    );
    expect(c.item.duplicateOf).toBeUndefined();
    expect(openItems(env)).toHaveLength(2);
  });

  it("forces action to none for anything it calls ignore", async () => {
    const c = await capture(
      { text: "thanks, great meeting!" },
      fake({ kind: kindAnswer("ignore"), action: kindAnswer("now", 0.9) }),
      env,
    );
    expect(c.item.action).toBe("none");
    expect(openItems(env)).toHaveLength(0);
  });

  it("throws rather than guessing when Jev returns no usable kind", async () => {
    await expect(capture({ text: "x" }, fake({}), env)).rejects.toThrow(/usable kind/);
    expect(readItems(env)).toHaveLength(0);
  });

  it("asks about routing and duplicates only when there is something to ask about", () => {
    expect(Object.keys(buildQuestions([], []))).toEqual(["kind", "action"]);
    const b = addBucket({ name: "P", shelf: "project", scope: "s" }, env);
    const item = addItem({ text: "t", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    expect(Object.keys(buildQuestions([b], [item])).sort()).toEqual(
      ["action", "duplicate", "kind", "nearest", "route"],
    );
  });

  it("puts the item, the buckets and the existing items in the state", () => {
    const b = addBucket({ name: "Warehouse", shelf: "project", scope: "the rollout" }, env);
    const item = addItem({ text: "earlier thing", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    const state = buildState("new thing", "email", [b], [item]);
    expect(state).toContain("new thing");
    expect(state).toContain("SOURCE: email");
    expect(state).toContain("Warehouse (project): the rollout");
    expect(state).toContain("earlier thing");
  });

  it("offers newest items first as duplicate candidates and skips known duplicates", () => {
    const a = addItem({ text: "a", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    const b = addItem({ text: "b", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    addItem({ text: "c", source: "n", kind: "task", action: "now", bucket: null, confidence: 1, duplicateOf: a.id }, env);
    const pool = candidates(readItems(env));
    expect(pool.map((i) => i.text)).toEqual(["b", "a"]);
    expect(pool[0]!.id).toBe(b.id);
  });
});

describe("shortlist", () => {
  const threeOpen = () => {
    addItem({ text: "urgent", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    addItem({ text: "middling", source: "n", kind: "task", action: "scheduled", bucket: null, confidence: 1 }, env);
    addItem({ text: "later", source: "n", kind: "personal-follow-up", action: "read-later", bucket: null, confidence: 1 }, env);
  };

  it("orders by weight, highest first", async () => {
    threeOpen();
    const ids = openItems(env).map((i) => i.id);
    const s = await shortlist(
      fake({
        [`i_${ids[0]}`]: { score: 1.0, confidence: 1, probabilities: {} },
        [`i_${ids[1]}`]: { score: 3.0, confidence: 1, probabilities: {} },
        [`i_${ids[2]}`]: { score: 2.0, confidence: 1, probabilities: {} },
      }),
      {},
      env,
    );
    expect(s.ranked.map((r) => r.item.text)).toEqual(["middling", "later", "urgent"]);
    expect(s.note).toBeUndefined();
  });

  it("returns everything unranked, with a reason, when there is no scorer", async () => {
    threeOpen();
    const s = await shortlist(null, {}, env);
    expect(s.ranked).toHaveLength(3);
    expect(s.note).toMatch(/TYPESAFE_API_KEY/);
    expect(s.ranked.every((r) => Number.isNaN(r.weight))).toBe(true);
  });

  it("returns everything unranked, with the error, when the scorer fails", async () => {
    threeOpen();
    const s = await shortlist({ async ask() { throw new Error("rate limited"); } }, {}, env);
    expect(s.ranked).toHaveLength(3);
    expect(s.note).toMatch(/rate limited/);
  });

  it("never drops an item the scorer did not answer for", async () => {
    threeOpen();
    const ids = openItems(env).map((i) => i.id);
    const s = await shortlist(fake({ [`i_${ids[0]}`]: { score: 3, confidence: 1, probabilities: {} } }), {}, env);
    expect(s.ranked).toHaveLength(3);
  });

  it("batches so no request carries more than BATCH questions", async () => {
    for (let i = 0; i < BATCH * 2 + 1; i++) {
      addItem({ text: `t${i}`, source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    }
    const sizes: number[] = [];
    const s = await shortlist(
      { async ask(_st, q) { sizes.push(Object.keys(q).length); return { answers: {} }; } },
      {},
      env,
    );
    expect(sizes).toEqual([BATCH, BATCH, 1]);
    expect(s.ranked).toHaveLength(BATCH * 2 + 1);
  });

  it("is empty and quiet when nothing is open", async () => {
    const s = await shortlist(fake({}), {}, env);
    expect(s.ranked).toEqual([]);
    expect(formatShortlist(s)).toContain("Nothing open");
  });
});

describe("format", () => {
  it("names the bucket, the duplicate and a close call", async () => {
    const b = addBucket({ name: "Warehouse", shelf: "project", scope: "rollout" }, env);
    const first = addItem({ text: "call the auditor", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    const c = await capture(
      { text: "ring the auditor" },
      fake({
        kind: { choice: "task", confidence: 0.45, probabilities: { task: 0.45, "personal-follow-up": 0.4 } },
        action: kindAnswer("now"),
        route: { choice: b.id, confidence: 0.8, probabilities: { [b.id]: 0.8 } },
        duplicate: { noul: 0.9 },
        nearest: { choice: first.id, confidence: 0.9, probabilities: { [first.id]: 0.9 } },
      }),
      env,
    );
    const out = formatCapture(c);
    expect(out).toContain("**task**");
    expect(out).toContain("Warehouse (0.80)");
    expect(out).toContain("looks like a duplicate");
    expect(out).toContain("close call: task 0.45 against personal-follow-up 0.40");
  });

  it("groups the shortlist under the rubric's own words", async () => {
    addItem({ text: "overdue thing", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    const id = openItems(env)[0]!.id;
    const s = await shortlist(fake({ [`i_${id}`]: { score: 3, confidence: 1, probabilities: {} } }), {}, env);
    expect(formatShortlist(s)).toContain("## overdue");
  });
});

describe("reading answers", () => {
  const res: JevResponse = {
    answers: {
      n: { noul: 0.42 },
      c: { choice: "x", confidence: 0.8, probabilities: { x: 0.8 } },
      s: { score: 2.5, confidence: 0.7, probabilities: {} },
    },
  };
  it("reads each answer type and returns null for the wrong one", () => {
    expect(noul(res, "n")).toBe(0.42);
    expect(choice(res, "c")?.choice).toBe("x");
    expect(score(res, "s")).toBe(2.5);
    expect(noul(res, "c")).toBeNull();
    expect(choice(res, "n")).toBeNull();
    expect(score(res, "missing")).toBeNull();
  });
});

describe("ordering does not depend on the clock", () => {
  it("puts the later item first even when both carry the same timestamp", () => {
    const a = addItem({ text: "a", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    const b = addItem({ text: "b", source: "n", kind: "task", action: "now", bucket: null, confidence: 1 }, env);
    // Force the collision that a fast machine produces on its own.
    const same = [
      { ...a, at: "2026-09-19T00:00:00.000Z" },
      { ...b, at: "2026-09-19T00:00:00.000Z" },
    ];
    expect(candidates(same).map((i) => i.text)).toEqual(["b", "a"]);
  });
});
