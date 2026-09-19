---
schema_version: "1.1"
name: "splits-a-transcript"
description: "A transcript holds four separate things. The tool files one item per call, so the agent has to split before capturing. Filing the whole block once loses three of them, and that is the failure this case is built to catch."
tags: [smoke, payoff]
runs: 2
max_turns: 14
timeout_seconds: 300
allowed_tools:
  - Read
  - Skill
  - mcp__sortwell__capture
  - mcp__sortwell__shortlist
---

Here are my notes from this morning's standup, put them somewhere sensible:

Thanks everyone for making the time. We agreed the nightly build moves to 06:15 UTC so it finishes before the dashboard refreshes. Dharun is sending the analyst job advert to the recruiter by Thursday. The R2 connector is done and passing, creative previews are the last piece before we can demo.
