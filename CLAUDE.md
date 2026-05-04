# Working Agreement — Alfred

This file defines how you (Claude Code, "the engineer") work on this project. Read it at the start of every session.

---

## Context: PM-Engineer Split

This project uses a two-Claude workflow:

- **PM Claude** writes specs and reviews execution reports. The user talks to PM Claude in claude.ai.
- **You (Claude Code)** execute the specs locally. The user runs you in their terminal.
- The user is the **carrier** between PM Claude and you. They paste handoffs from PM Claude to you, and paste your reports back to PM Claude.

You and PM Claude never communicate directly. Everything goes through the user as files and pasted text.

---

## Source-of-Truth Documents

| Path | Purpose | Mutability |
|---|---|---|
| `docs/alfred-phase-0-1-spec.md` | Primary spec (current phase) | PM Claude only — propose amendments via report, don't edit directly |
| `docs/handoffs/` | Every handoff message from PM Claude, archived | Append-only (one file per handoff) |
| `docs/ADR.md` | Architecture Decision Records — your local decisions | Append-only |
| `docs/log.md` | Project journal | **Prepend-only** (newest at top) |
| `docs/reports/` | Your execution reports per task | Append-only |
| `CLAUDE.md` | This file | Update only when user explicitly asks |

---

## Operating Rules

### Rule 1 — Archive every handoff before acting

When the user pastes content marked as a handoff from PM Claude (specs, iteration feedback, amendments, or simple instructions), your **first action** is to save it as a file:

```
docs/handoffs/YYYY-MM-DD-HHMM-<short-slug>.md
```

The file's first line is a header with the timestamp and a one-line summary. The body is the verbatim content the user pasted. After saving, acknowledge the save (path + slug), then proceed to act on the content.

A handoff is anything the user introduces with phrasing like "PM 說...", "這是新的 handoff", "這份 spec...", or by pasting a structured doc / report. When in doubt, ask the user "this looks like a handoff — should I archive it before acting?"

### Rule 2 — ADR for every local decision

A "local decision" is anything you decide that isn't explicitly specified in the spec or a handoff. Examples:

- Choosing a specific library when the spec says "an HTML-stripping library"
- Picking a file structure detail beyond the spec's outline
- Choosing an error handling approach not pinned by the spec
- Deciding what counts as "duplicate" when the heuristic isn't precisely specified

For every such decision, **before** committing the affected code, append an entry to `docs/ADR.md`:

```markdown
## ADR-NNN — <short imperative title>

- **Date:** YYYY-MM-DD
- **Status:** accepted
- **Task:** Task N (or "cross-cutting")

### Context
What problem / choice point triggered this. 2-4 sentences.

### Decision
What you chose. 1-3 sentences.

### Alternatives considered
Bullet list, one line each.

### Consequences
What this enables, what it costs, what it locks out. 2-4 bullets.
```

NNN is a zero-padded sequential number (`001`, `002`, ...). Never reuse a number. Reference ADR numbers in execution reports and commit messages.

If a decision later turns out wrong, **don't delete the ADR** — append a new ADR with `Status: supersedes ADR-NNN` and explain.

### Rule 3 — Maintain `docs/log.md` (prepend-only)

Every meaningful event gets an entry **prepended** to `docs/log.md` (newest first, oldest last):

```markdown
## YYYY-MM-DD HH:MM — <event title>
<2-3 sentence narrative of what happened, what was decided, what's next>
```

Meaningful events:
- Session started / ended
- Task started, completed, blocked
- Handoff received and archived
- ADR recorded
- Commit pushed
- Significant blocker encountered

The log is the project's chronological story. Anyone (including future you) should be able to scan the top of the log and understand what's been happening.

### Rule 4 — Git hygiene

You manage commits. Rules:

1. **No commit without explicit user acceptance.** When you complete a task, you write the report, present it, and **wait** for the user to confirm the task is accepted. Only then do you commit.
2. **Commit message format:** Conventional Commits.
   ```
   <type>(<scope>): <subject>

   <body explaining what and why, referencing Task N and any ADRs>

   Refs: Task N
   ADRs: ADR-003, ADR-004
   ```
   Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`.
3. **One commit per task** when reasonable. Split only if there are clearly independent logical chunks.
4. **Push after every accepted task.** Don't accumulate local commits.
5. **Branch:** work directly on `main` for this project. It's a single-developer project; branching adds friction without value.
6. **Never force-push.** History is forward-only.
7. **`docs/` changes commit alongside code changes.** ADR / log / report updates for a task go in the same commit as the code for that task. If the user is iterating on the spec only (no code), commit those alone with `docs(spec): ...`.

### Rule 5 — Execution reports

Follow the format in §12 of the spec doc. Two output channels per report:
1. **Save to** `docs/reports/task-NN-report.md`
2. **Print inline** so the user can copy-paste into PM Claude without opening a file

The report is the single deliverable that tells PM Claude what happened. Make it complete and self-contained.

---

## Session Start Checklist

At the start of every session, before doing any work:

1. Read `docs/alfred-phase-0-1-spec.md` (or whatever the current spec is).
2. List files in `docs/handoffs/` and read any you haven't seen before.
3. Read the top ~20 entries of `docs/log.md`.
4. Skim `docs/ADR.md` for context on past decisions.
5. State explicitly: "I'm picking up at Task N. Last session ended with X. Any blocking questions: [...]". Wait for user confirmation before proceeding.

## Session End Checklist

When the user signals end of session (or you complete and commit a task and there's nothing more queued):

1. Prepend a "session ended" entry to `docs/log.md` summarizing what was accomplished.
2. Confirm `git status` is clean (or note what's intentionally uncommitted).
3. Confirm `git push` is up to date.

---

## Don'ts

- **Don't proceed past a blocking question.** Surface it, wait, don't guess.
- **Don't modify** `docs/alfred-phase-0-1-spec.md`. Propose amendments in your report; PM Claude will issue an updated spec.
- **Don't skip ADR** for non-trivial local decisions. If you're unsure whether a decision is "trivial," err toward writing the ADR — the cost is one minute, the benefit is durable rationale.
- **Don't commit work that fails tests** unless the user has explicitly accepted that exception (and an ADR records it).
- **Don't auto-commit on task completion.** Wait for user acceptance.
- **Don't bundle multiple tasks** in one commit unless they're trivially small and tightly related.

---

## Quick Reference: Folder Structure

```
alfred/
├── CLAUDE.md                     ← this file
├── README.md
├── docs/
│   ├── alfred-phase-0-1-spec.md  ← current spec from PM Claude
│   ├── handoffs/                 ← every handoff archived
│   │   └── 2026-05-04-1430-initial-spec.md
│   ├── reports/                  ← execution reports per task
│   │   └── task-01-report.md
│   ├── ADR.md                    ← local decisions, append-only
│   └── log.md                    ← project journal, prepend-only
├── src/                          ← per spec §3.2
├── tests/
└── wrangler.toml
```
