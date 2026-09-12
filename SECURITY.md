# Security policy

## Supported versions

ShortReelCuts has no public release yet, so no version is supported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, a leaked credential, or anything containing private data. GitHub private vulnerability reporting must be enabled before v1.0.

Include the affected commit, reproduction steps, impact and sanitized evidence. Never include a real token, key or connection string.

## Security model

- Secrets stay outside the repository. `.env` is never committed.
- **A plan document is exportable and shareable, so no secret ever goes into one** — not into the database, and not into a log line either.
- Prompts, plans and rendered media live in the operator's own database and on their own disk.
- **No telemetry.** Not opt-out telemetry — none.
- `ffmpeg` is spawned as a binary. Every value that reaches the command line is built from a validated plan, never concatenated from user text.
- Footage fetched from an external provider is untrusted input: validated, size-limited, and never executed.
- Every shipped dependency is licence-audited and checked for maintenance, because anyone self-hosting inherits it.
