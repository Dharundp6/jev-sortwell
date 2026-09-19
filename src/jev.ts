/**
 * The TypeSafe System One client.
 *
 * Talks to api.typesafe.ai directly rather than through a gateway: measured
 * at roughly half the latency, and it returns the model version and token
 * usage, which the gateway route does not.
 */
import type { Asker, JevQuestion, JevResponse } from "./types.js";

export const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";

export interface JevOptions {
  apiKey?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export function apiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.TYPESAFE_API_KEY || env.SORTWELL_API_KEY || undefined;
}

export function jevAsker(options: JevOptions = {}): Asker | null {
  const apiKey = options.apiKey ?? apiKeyFromEnv();
  if (!apiKey) return null;
  const url = options.baseUrl ?? SYSTEM_ONE_URL;
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    async ask(state: string, questions: Record<string, JevQuestion>): Promise<JevResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model, state, questions }),
          signal: controller.signal,
        });
      } catch (err) {
        throw new JevError(
          err instanceof Error && err.name === "AbortError"
            ? `Jev timed out after ${timeoutMs}ms`
            : `Jev unreachable: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      if (!res.ok) throw new JevError(`Jev returned ${res.status}: ${text.slice(0, 200)}`, res.status);

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new JevError("Jev returned malformed JSON");
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        typeof (parsed as { answers?: unknown }).answers !== "object" ||
        (parsed as { answers?: unknown }).answers === null
      ) {
        throw new JevError("Jev response has no answers");
      }
      return parsed as JevResponse;
    },
  };
}

// ------------------------------------------------- reading answers safely

/** The probability of a `noul` answer, or null when it is not one. */
export function noul(res: JevResponse, key: string): number | null {
  const a = res.answers[key] as { noul?: unknown } | undefined;
  return typeof a?.noul === "number" && Number.isFinite(a.noul) ? a.noul : null;
}

/**
 * A `choice` answer. Returns the winner and the full distribution, so a
 * near-tie stays visible to the caller instead of being flattened.
 */
export function choice(
  res: JevResponse,
  key: string,
): { choice: string; confidence: number; probabilities: Record<string, number> } | null {
  const a = res.answers[key] as
    | { choice?: unknown; confidence?: unknown; probabilities?: unknown }
    | undefined;
  if (typeof a?.choice !== "string") return null;
  return {
    choice: a.choice,
    confidence: typeof a.confidence === "number" ? a.confidence : 0,
    probabilities:
      a.probabilities && typeof a.probabilities === "object"
        ? (a.probabilities as Record<string, number>)
        : {},
  };
}

/** A `score` answer, as a number on the rubric's scale. */
export function score(res: JevResponse, key: string): number | null {
  const a = res.answers[key] as { score?: unknown } | undefined;
  return typeof a?.score === "number" && Number.isFinite(a.score) ? a.score : null;
}
