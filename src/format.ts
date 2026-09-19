/** Rendering. Markdown for a person or an agent to read. */
import type { Capture } from "./types.js";
import type { Shortlist } from "./shortlist.js";

const WEIGHT_LABEL = ["nothing today", "soon", "today", "overdue"];

export function formatCapture(c: Capture): string {
  const { item } = c;
  const out = [`filed ${item.id} as a **${item.kind}**, action **${item.action}**`];
  out.push(
    c.routedTo
      ? `  project: ${c.routedTo.bucket.name} (${c.routedTo.confidence.toFixed(2)})`
      : `  project: none, left in the inbox`,
  );
  if (item.duplicateOf && c.nearest) {
    out.push(
      `  **looks like a duplicate** (${c.duplicateProbability.toFixed(2)}) of ${c.nearest.id}: ${c.nearest.text.slice(0, 80)}`,
    );
  } else if (c.duplicateProbability >= 0.4 && c.nearest) {
    out.push(
      `  similar to ${c.nearest.id} (${c.duplicateProbability.toFixed(2)}), kept as separate`,
    );
  }
  const sorted = Object.entries(c.kindProbabilities).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0] && sorted[1] && sorted[0][1] - sorted[1][1] < 0.2) {
    out.push(
      `  close call: ${sorted[0][0]} ${sorted[0][1].toFixed(2)} against ${sorted[1][0]} ${sorted[1][1].toFixed(2)}`,
    );
  }
  out.push(`  ${c.ms}ms`);
  return out.join("\n");
}

export function formatShortlist(s: Shortlist): string {
  const out = ["# What matters"];
  if (s.note) out.push(`_${s.note}_`);

  if (s.ranked.length === 0) {
    out.push("", "_Nothing open._");
  } else {
    let band = "";
    for (const r of s.ranked) {
      const label = Number.isNaN(r.weight)
        ? "unranked"
        : (WEIGHT_LABEL[Math.min(3, Math.round(r.weight))] ?? "soon");
      if (label !== band) {
        out.push("", `## ${label}`);
        band = label;
      }
      const w = Number.isNaN(r.weight) ? "" : ` (${r.weight.toFixed(2)})`;
      const where = r.bucket ? ` · ${r.bucket.name}` : " · inbox";
      const text = r.item.text.replace(/\s+/g, " ");
      out.push(`- ${r.item.id}${w} · ${r.item.kind}${where}`);
      out.push(`  ${text.length > 140 ? `${text.slice(0, 137)}...` : text}`);
    }
  }

  if (s.stale.length > 0) {
    out.push("", "## Gone quiet");
    for (const { bucket, lastSeen } of s.stale) {
      out.push(`- ${bucket.name} — ${lastSeen ? `nothing since ${lastSeen.slice(0, 10)}` : "nothing captured yet"}`);
    }
  }
  return out.join("\n");
}
