/** The MCP server: four tools over stdio. */
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { capture } from "./capture.js";
import { formatCapture, formatShortlist } from "./format.js";
import { jevAsker } from "./jev.js";
import { shortlist } from "./shortlist.js";
import { addBucket, markDone, openBuckets, readItems } from "./store.js";
import { SHELVES } from "./types.js";

export const VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

const CAPTURE_DESC = `Save something the user wants kept: a note, a link, an email, a line from a \
meeting, anything. Call it once per distinct item; paste a transcript one item at a time rather \
than all at once. It decides for itself what kind of thing the item is, which of the user's \
projects it belongs to, whether it needs attention, and whether they already have it, then files \
it. The text is stored exactly as given and never rewritten. You do not need to classify anything \
yourself, and you should not ask the user which project it belongs to.`;

const SHORTLIST_DESC = `The few things that matter today, ranked out of everything still open, \
with any projects that have gone quiet. Call it when the user asks what they should be doing, what \
is outstanding, or at the start of a working session. Takes no arguments.`;

const PROJECT_DESC = `Add a project or an area so captured items have somewhere to go. A project \
finishes; an area is ongoing. The scope line is what routing is judged against, so write it as a \
plain description of what belongs here rather than a title.`;

const DONE_DESC = `Mark an item finished so it leaves the shortlist. Nothing is deleted.`;

/** See carryforward: the SDK validates asynchronously, so pipelined calls can interleave. */
export function orderToolCalls(transport: {
  onmessage?: ((m: JSONRPCMessage, extra?: unknown) => void) | undefined;
  send: (m: JSONRPCMessage, options?: unknown) => Promise<void>;
}): void {
  const deliver = transport.onmessage;
  if (!deliver) return;
  const send = transport.send.bind(transport);
  const settled = new Map<RequestId, () => void>();
  let chain: Promise<void> = Promise.resolve();
  const idOf = (m: JSONRPCMessage): RequestId | undefined => (m as { id?: RequestId }).id;
  const release = (id: RequestId | undefined): void => {
    if (id !== undefined) settled.get(id)?.();
  };

  transport.send = async (m, options) => {
    await send(m, options);
    if ("result" in m || "error" in m) release(idOf(m));
  };
  transport.onmessage = (m, extra) => {
    const id = idOf(m);
    const method = "method" in m ? m.method : undefined;
    if (method === "notifications/cancelled") {
      release((m as { params?: { requestId?: RequestId } }).params?.requestId);
      deliver(m, extra);
      return;
    }
    if (method !== "tools/call" || id === undefined) {
      deliver(m, extra);
      return;
    }
    chain = chain.then(
      () =>
        new Promise<void>((done) => {
          settled.set(id, () => {
            settled.delete(id);
            done();
          });
          deliver(m, extra);
        }),
    );
  };
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ isError: true, content: [{ type: "text" as const, text: t }] });

export function buildServer(): McpServer {
  const server = new McpServer({ name: "sortwell", version: VERSION });

  server.registerTool(
    "capture",
    {
      title: "Capture an item",
      description: CAPTURE_DESC,
      inputSchema: {
        text: z.string().min(1).describe("the item, verbatim; it is stored exactly as given"),
        source: z
          .string()
          .optional()
          .describe("where it came from: note, url, email, meeting, voice. Defaults to note"),
      },
    },
    async (args) => {
      const asker = jevAsker();
      if (!asker) return fail("not captured: TYPESAFE_API_KEY is not set, and capture needs it to decide where this goes");
      try {
        const source = args.source;
        const c = await capture(source === undefined ? { text: args.text } : { text: args.text, source }, asker);
        return text(formatCapture(c));
      } catch (err) {
        return fail(`not captured: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.registerTool(
    "shortlist",
    { title: "What matters today", description: SHORTLIST_DESC, inputSchema: {} },
    async () => text(formatShortlist(await shortlist(jevAsker(), { limit: 12 }))),
  );

  server.registerTool(
    "add_project",
    {
      title: "Add a project or area",
      description: PROJECT_DESC,
      inputSchema: {
        name: z.string().min(1).describe("short name, for example 'Warehouse rollout'"),
        shelf: z.enum(SHELVES).describe("project finishes, area is ongoing, resource is reference, archive is closed"),
        scope: z.string().min(1).describe("one line describing what belongs here; routing is judged against this"),
      },
    },
    async (args) => {
      try {
        const b = addBucket(args);
        return text(`added ${b.shelf} ${b.id}: ${b.name}`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "mark_done",
    {
      title: "Mark an item done",
      description: DONE_DESC,
      inputSchema: { id: z.string().min(1).describe("the item id, as shown in the shortlist") },
    },
    async ({ id }) => {
      try {
        markDone(id);
        return text(`${id} marked done`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerResource?.(
    "projects",
    "sortwell://projects",
    { title: "Projects and areas", mimeType: "text/plain" },
    async () => ({
      contents: [
        {
          uri: "sortwell://projects",
          text:
            openBuckets()
              .map((b) => `${b.id} — ${b.name} (${b.shelf}): ${b.scope}`)
              .join("\n") || "(none yet)",
        },
      ],
    }),
  );

  return server;
}

export async function serve(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  orderToolCalls(transport);
}

export { readItems };
