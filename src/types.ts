/**
 * An inbox with judgment.
 *
 * Jev decides four things about a captured item and writes none of them:
 * what kind of thing it is, which project it belongs to, what it needs from
 * you, and whether you already have it. Code does everything else. No text
 * is generated anywhere in this package.
 */

/** What a captured item is. The labels come from the decision, not from parsing. */
export const KINDS = [
  "task",
  "decision",
  "project-update",
  "reference",
  "personal-follow-up",
  "ignore",
] as const;
export type Kind = (typeof KINDS)[number];

/** What the item needs from you next. */
export const ACTIONS = ["now", "scheduled", "read-later", "none"] as const;
export type Action = (typeof ACTIONS)[number];

/** Where an item comes to rest. Mirrors projects / areas / resources / archive. */
export const SHELVES = ["project", "area", "resource", "archive"] as const;
export type Shelf = (typeof SHELVES)[number];

/** A project or area the user already has. Items get routed to one of these. */
export interface Bucket {
  id: string;
  /** "Warehouse rollout", "Health", "Reading" */
  name: string;
  shelf: Shelf;
  /** One line telling Jev what belongs here. This is the routing criterion. */
  scope: string;
  /** Set when the user closes it; a closed bucket is not a routing candidate. */
  closedAt?: string;
}

export interface Item {
  id: string;
  /** Verbatim. Never rewritten, never summarised. */
  text: string;
  /** Where it came from: "note", "url", "email", "meeting", "voice". Free text. */
  source: string;
  kind: Kind;
  action: Action;
  /** Bucket id, or null when nothing fitted and it went to the inbox. */
  bucket: string | null;
  /** Jev's confidence in the kind, kept so a weak call can be reviewed. */
  confidence: number;
  /** Set when the item was filed as a near-duplicate of an existing one. */
  duplicateOf?: string;
  /** Set when the user marks it done. Done items leave the shortlist. */
  doneAt?: string;
  at: string;
}

/** What `capture` decided, returned so a caller can show its reasoning. */
export interface Capture {
  item: Item;
  /** Probability per kind, so a near-tie is visible rather than hidden. */
  kindProbabilities: Record<string, number>;
  /** The bucket Jev picked and how sure it was; null when it chose the inbox. */
  routedTo: { bucket: Bucket; confidence: number } | null;
  /** Probability that this duplicates something already stored. */
  duplicateProbability: number;
  /** The item it looked most like, whether or not it crossed the threshold. */
  nearest: Item | null;
  ms: number;
}

/** One row of the daily shortlist. */
export interface Ranked {
  item: Item;
  /** 0 to 3, from Jev's score question. Higher means it matters more today. */
  weight: number;
  bucket: Bucket | null;
}

// ---------------------------------------------------------------- the model

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { noul: number }
  | { choice: string; confidence: number; probabilities: Record<string, number> }
  | { score: number; confidence: number; probabilities: Record<string, number> };

export interface JevResponse {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Anything that can answer Jev questions. The default talks to TypeSafe
 * directly; tests pass a fake and never touch the network.
 */
export interface Asker {
  ask(state: string, questions: Record<string, JevQuestion>): Promise<JevResponse>;
}
