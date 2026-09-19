#!/usr/bin/env node
/** The executable. No arguments serves MCP over stdio. */
import { capture } from "./capture.js";
import { formatCapture, formatShortlist } from "./format.js";
import { jevAsker } from "./jev.js";
import { shortlist } from "./shortlist.js";
import { addBucket, openBuckets, storeDir } from "./store.js";
import { serve } from "./server.js";
import { SHELVES, type Shelf } from "./types.js";

const USAGE = `sortwell — an inbox with judgment

  sortwell                       serve MCP over stdio
  sortwell capture <text>        file one item
  sortwell shortlist [--quiet]   what matters today
  sortwell project <shelf> <name> -- <scope>
  sortwell projects              list projects and areas
  sortwell where                 where things are kept
`;

export async function cli(argv: readonly string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  if (cmd === undefined || cmd === "serve") {
    await serve();
    return 0;
  }

  if (cmd === "capture") {
    const text = rest.join(" ").trim();
    if (!text) { process.stderr.write("sortwell: nothing to capture\n"); return 2; }
    const asker = jevAsker();
    if (!asker) { process.stderr.write("sortwell: set TYPESAFE_API_KEY to capture\n"); return 1; }
    process.stdout.write(`${formatCapture(await capture({ text }, asker))}\n`);
    return 0;
  }

  if (cmd === "shortlist") {
    const quiet = rest.includes("--quiet") || rest.includes("-q");
    const s = await shortlist(jevAsker(), { limit: 12 });
    if (quiet && s.ranked.length === 0 && s.stale.length === 0) return 0;
    process.stdout.write(`${formatShortlist(s)}\n`);
    return 0;
  }

  if (cmd === "project") {
    const i = rest.indexOf("--");
    const shelf = rest[0];
    const name = rest.slice(1, i === -1 ? undefined : i).join(" ").trim();
    const scope = i === -1 ? "" : rest.slice(i + 1).join(" ").trim();
    if (!shelf || !SHELVES.includes(shelf as Shelf) || !name || !scope) {
      process.stderr.write(`sortwell: project <${SHELVES.join("|")}> <name> -- <scope>\n`);
      return 2;
    }
    const b = addBucket({ name, shelf: shelf as Shelf, scope });
    process.stdout.write(`added ${b.shelf} ${b.id}: ${b.name}\n`);
    return 0;
  }

  if (cmd === "projects") {
    const list = openBuckets();
    process.stdout.write(list.length ? `${list.map((b) => `${b.id}  ${b.shelf.padEnd(8)} ${b.name}\n    ${b.scope}`).join("\n")}\n` : "(none yet)\n");
    return 0;
  }

  if (cmd === "where") { process.stdout.write(`${storeDir()}\n`); return 0; }

  process.stdout.write(USAGE);
  return cmd === "help" || cmd === "--help" ? 0 : 2;
}

cli(process.argv.slice(2))
  .then((c) => { if (c !== 0) process.exitCode = c; })
  .catch((e) => { process.stderr.write(`sortwell: ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });
