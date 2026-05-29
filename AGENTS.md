# AGENTS.md — CI-Pebble

## Platform context

CI-Pebble is the **Device** layer component of the Companion Intelligence platform — a private, local-first digital memory system.

Full architecture: `CI-Engineering/architecture/architecture.md`

## Repo summary

Companion Intelligence integration for the Pebble smartwatch — capture and notification surface.

## Stack

- Pebble SDK / C / JavaScript
- Companion app transport

## Setup & commands

```bash
npm install   # install
npm run dev   # dev
npm test   # test
npm run build   # build
```



## Git discipline

- Never `git reset --hard` or `git clean -f` without user confirmation.
- Commit messages: imperative mood, ≤ 72 chars.
- Reference CI-Engineering issues in PRs (e.g. `Closes companionintelligence/CI-Engineering#32`).

## Confidentiality

Private & Confidential — Property of Lifescope Inc. Do not distribute.
