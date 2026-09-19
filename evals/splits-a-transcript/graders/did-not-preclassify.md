---
type: regex
pattern: "which project|where should|shall I file|what category|do you want me to"
match: not_contains
flags: i
target: last_message
weight: 1
arm: both
---

The tool decides the kind and the project. An agent that asks the user where
something belongs has moved the judgement back to the person, which is the
thing being removed.
