# ANTIGRAVITY.md — CI-Pebble

## Context

**CI-Pebble** — **Device** layer of the Companion Intelligence platform (Lifescope Inc).

Architecture: `CI-Engineering/architecture/architecture.md`
Roadmap: `CI-Engineering/architecture/roadmap.md`

## Purpose

Companion Intelligence integration for the Pebble smartwatch — capture and notification surface.

## Stack

- Pebble SDK / C / JavaScript
- Companion app transport

## Commands

```bash
npm install
npm run dev
npm test
```

## Rules

- Package manager: do not switch or mix.
- Destructive git operations (`reset --hard`, `clean -f`) require explicit user confirmation.
- Commits reference CI-Engineering issues.
- All content is **private and confidential** — Property of Lifescope Inc.
