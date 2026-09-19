# sortwell

**An inbox with judgment.**

You paste something. It decides what kind of thing it is, which project it belongs to, whether it needs you, and whether you already have it. Then it files it. Your text is stored exactly as you wrote it.

The deciding is done by [Jev](https://typesafe.ai), an evaluation model that answers typed questions with probabilities and writes no text at all. That is the point: it sorts your notes, it cannot rewrite them.

[![MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![decided by Jev](https://img.shields.io/badge/decided%20by-Jev-6f42c1)](https://typesafe.ai)

## What it does

Four tools over MCP.

| tool | what it does |
|---|---|
| `capture` | files one item: decides kind, project, urgency, and duplicate, in one request |
| `shortlist` | the few things that matter today, ranked, plus projects gone quiet |
| `add_project` | a project finishes, an area is ongoing |
| `mark_done` | takes an item off the list; nothing is deleted |

Every item is labelled one of `task`, `decision`, `project-update`, `reference`, `personal-follow-up` or `ignore`, and given an action of `now`, `scheduled`, `read-later` or `none`.

## A real run

A seven line standup transcript, captured one line at a time against three projects, live:

```
ok   ignore              inbox              thanks everyone for making the time
ok   decision            Warehouse rollout  nightly build moves to 06:15 UTC
ok   task                Hiring an analyst  send the job advert by Thursday
ok   project-update      Warehouse rollout  R2 connector done, previews last
ok   reference           Reading            that piece on evaluation models
ok   personal-follow-up  inbox              I still owe Priya an introduction
DUP  (0.96)              Hiring an analyst  can someone get the job ad over
```

**Kind 6/6. The duplicate caught at 0.96. 424 ms per capture.** The reworded repeat of the job advert line was filed as a duplicate rather than a second task, so it never reached the list.

Then the shortlist put `I still owe Priya an introduction, I keep forgetting` at the top, above both project items. The pleasantry and the duplicate were already gone.

One label of mine was wrong, not the model's: I expected the article link to sit in the inbox and it went to the Reading area, whose scope says "articles worth reading at some point". It was right.

## What the eval found

`evals/` holds a `claude plugin eval` suite, and its result is worth knowing before you build anything like this.

**Given the tools and a skill telling it to use them, the agent called `capture` zero times in four runs.** Handed a transcript and asked to file it, it wrote its own tidy summary instead. Not blocked, no error, just never reached for. The same thing happened with a sister project, so it is a pattern, not a fluke.

The lesson: **an MCP server is not a behaviour change.** Tools sitting there, even with a skill, do not reliably get used. The `SessionStart` hook works because it runs whether or not the model decides to look. Treat the tools as the thing that does the work and the hook as the thing that makes it happen.

## Install

Needs Node 22 or newer and a [TypeSafe](https://typesafe.ai) API key. Not published to npm; clone it.

```sh
git clone https://github.com/Dharundp6/jev-sortwell && cd jev-sortwell
npm install && npm run build
export TYPESAFE_API_KEY=...
```

Try it without any client:

```sh
node dist/cli.js project project "Hiring an analyst" -- "recruiting one analyst: advert, screening, interviews, offer"
node dist/cli.js capture "Dharun to send the job advert to the recruiter by Thursday"
node dist/cli.js shortlist
```

As a Claude Code plugin, from the repo root:

```sh
claude plugin marketplace add Dharundp6/jev-sortwell
claude plugin install sortwell@sortwell
```

Or wire the server into any MCP client:

```json
{
  "mcpServers": {
    "sortwell": {
      "command": "node",
      "args": ["/absolute/path/to/jev-sortwell/dist/cli.js"],
      "env": { "TYPESAFE_API_KEY": "..." }
    }
  }
}
```

## How it decides

One request per capture, four questions answered in parallel: kind, project, action, duplicate. Jev is an evaluation model, so all four come back as probabilities and code does the rest.

Two thresholds, both exported constants rather than hidden numbers. Routing needs **0.45** or the item stays in the inbox, because a wrong home is worse than no home. A duplicate needs **0.70** *and* a specific item it duplicates, because both questions have to agree.

Ranking is the safe use of a probability. Being ranked third instead of second costs nothing, which is not true of being deleted.

## Where things are kept

Two append-only JSONL files in `~/.sortwell`, override with `SORTWELL_DIR`. Nothing is rewritten and nothing is deleted: marking an item done appends a new version and the old line stays. A damaged line is skipped and counted, never removed.

## What it will never do

- **Never rewrite your text.** Items are stored verbatim. Jev cannot generate text, so this is structural rather than a promise.
- **Never delete.** `mark_done` and `close` append; the file only grows.
- **Never guess a home.** Below the routing threshold it says inbox.
- **Never fail closed.** No key, or a scorer that errors, and `shortlist` returns everything unranked with a line saying why.

## Development

```sh
npm install && npm run check
```

26 tests, a fake scorer, no network.

## License

MIT
