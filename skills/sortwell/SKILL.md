---
name: sortwell
description: Use whenever the user shares something worth keeping, such as a meeting transcript, a link, a note, an email, or a decision they just made, and whenever they ask what they should be working on, what is outstanding, or what matters today. Files each item by itself and ranks open work.
---

# sortwell

An inbox with judgment. `capture` files one item. `shortlist` says what matters
today. Two more tools, `add_project` and `mark_done`, keep the shape right.

## Capturing

Call `capture` once per distinct item. Given a meeting transcript or a wall of
notes, **split it first and capture each line separately**, because one call
produces one filed item and a paragraph containing a decision and two tasks
will be filed as a single thing.

Pass the text **verbatim**. Do not tidy it, summarise it, or rewrite it into
your own words. It is stored exactly as given, and the user's phrasing is what
they will recognise later.

Do not classify anything yourself and do not ask which project something
belongs to. The tool decides the kind, the project, whether it needs
attention, and whether the user already has it. That is its entire job. Set
`source` when you know it: `meeting`, `email`, `url`, `voice`, otherwise leave
it.

Capture the pleasantries too, rather than filtering first. They come back
marked `ignore` and cost nothing, and letting the tool decide keeps the
judgement in one place instead of splitting it between you and it.

When the result says an item looks like a duplicate, tell the user which
existing item it matched rather than silently moving on.

## Asking what matters

Call `shortlist` when the user asks what they should do, what is outstanding,
what is on their plate, or at the start of a working session. It takes no
arguments. It returns open items grouped by how much they matter today, plus
any projects that have gone quiet without being closed.

Read the groups back as they are. Do not re-rank them, and do not fold the
"nothing today" group into the urgent ones.

## Projects

Routing is judged against a project's **scope**, not its name, so a scope of
"the launch" routes badly and "shipping the v2 launch: pricing page, migration
emails, the changelog" routes well. When `add_project` is called, write the
scope as a plain description of what belongs there.

A project finishes; an area is ongoing. Use `area` for things like Reading or
Health that never complete.

If captures keep landing in the inbox with no project, that usually means a
project is missing or its scope is too vague. Say so.

## What not to do

Do not use these tools as a general note store for your own working notes. Do
not capture secrets. Nothing is ever deleted, so treat a capture as permanent.
