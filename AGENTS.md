# Guide for AI Agents in This Stack

Purpose: This service provides a lightweight, session-scoped calendar REST API backed by PostgreSQL. It is designed to run inside a private, co-located container stack and is only intended to be accessed by another AI agent in the same stack/network namespace.

Key Assumptions
- Private Network: The API is not exposed to the public internet; access is limited to an internal network shared with your agent.
- No External Auth: Because of private deployment, the API does not implement authentication by default. If exposure changes, add an auth layer (see Optimization Plan).
- Stateless API: The API is stateless; PostgreSQL holds all state. Horizontal scaling is possible with shared DB.

What’s Implemented
- Protocol: HTTP/JSON (no external web framework).
- Health: `GET /health` returns `{ ok: true }` when ready.
- Sessions: All data is keyed by `session_id` to isolate multiple conversations/tenants.
- Events CRUD:
  - `GET /sessions` → list known session IDs.
  - `POST /sessions/:sessionId/events` → create event.
  - `GET /sessions/:sessionId/events?range_start=ISO&range_end=ISO` → list events (optional time range).
  - `GET /sessions/:sessionId/events/:eventId` → read event.
  - `PATCH /sessions/:sessionId/events/:eventId` → partial update.
  - `DELETE /sessions/:sessionId/events/:eventId` → delete event.
- Validation: ISO 8601 datetimes; `end` must be after `start`. Invalid input returns 400.
- Graceful Shutdown: SIGINT/SIGTERM close DB pool cleanly.
- Storage: PostgreSQL with indexes on `session_id` and `(session_id, start)`.

Event JSON Shape
- `{ id, title, description, location, attendees[], start, end, status, createdAt, updatedAt }`
- All datetimes are ISO 8601 strings.

Environment
- `PORT` (default 3000)
- `DATABASE_URL` or `PG*` env vars (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSL`)

Container/Compose
- Image: `node:20-alpine` base, production deps only.
- Compose service `api` depends on `db` and uses `DATABASE_URL=postgres://postgres:postgres@db:5432/calendar_mcp`.
- Intended use inside the same compose network as your AI agent. Do not publish `api` ports unless required.

Quick Usage Examples
- Create event:
  - `POST /sessions/{sessionId}/events`
  - Body: `{ "title": "Call", "start": "2025-01-10T09:00:00Z", "end": "2025-01-10T09:30:00Z" }`
- List events in range:
  - `GET /sessions/{sessionId}/events?range_start=2025-01-01T00:00:00Z&range_end=2025-01-31T23:59:59Z`

Operational Notes
- Schema auto-creates on boot. No external migration tool yet.
- Pooling: Single `pg` Pool per process. Close via signals.
- Error model: 400 on invalid JSON/arguments, 404 when not found, 500 otherwise.

Constraints and Expectations
- Only internal agents should call this API. If you must expose it, add auth, TLS, and rate limits.
- Use stable, meaningful `session_id` values to keep conversations isolated.
- For large lists, client-side pagination may be necessary until server pagination is added.

Optimization Plan (Prioritized)
1) Security Hardening (for internal-by-default, optional exposure)
- Add optional shared-secret auth header (e.g., `X-Internal-Token`) gated by env `INTERNAL_TOKEN`.
- Compose network isolation: ensure `api` has no published ports; restrict to a private network. If publishing, enable reverse proxy with TLS.
- Add basic request size limits and safer JSON parsing guards.

2) Performance and Scalability
- Add pagination to `GET /events` (e.g., `limit`, `cursor`) to bound payloads.
- Use server-side filtering on time windows (already supported) and consider prepared statements for hot paths.
- Tune `pg` pool size via env, and add keep-alive/socket tuning. Consider statement timeouts.
- Add additional index on `(session_id, end)` if queries skew toward end-time filters.

3) Reliability and Data Safety
- Introduce migrations (Prisma or node-pg-migrate) to evolve schema safely.
- Backups/retention policy for `events`; optional archival/TTL for old sessions.
- Add readiness and liveness checks (HTTP `/health` is live; add `/ready` that verifies DB).

4) Observability
- Structured logging with request IDs and latency; redact PII.
- Basic metrics (Prometheus): request counts, latencies, DB wait time, pool stats.
- Error taxonomy/code map to keep 4xx/5xx consistent.

5) API Ergonomics
- Input schema validation (e.g., `zod`) for clearer errors and types.
- Enum for `status` with validation; document allowed values in responses.
- Optional features: recurring events, ICS import/export, conflict detection.

6) Container and Runtime Hygiene
- Run as non-root user, set read-only filesystem, drop capabilities.
- Add `HEALTHCHECK` in Dockerfile to probe `/health`.
- Multi-stage build if dev tooling is added later; keep image small.

7) Developer Experience
- Unit tests for date validation and CRUD paths; lightweight integration tests against a test DB.
- CI with lint/test; pre-commit hooks optional.
- Seed scripts and example calls for local/dev.

Suggested Next Tasks
- Add optional internal token auth behind env flag.
- Implement pagination parameters and document them.
- Add `/ready` endpoint that performs a simple DB query.
- Introduce migration tooling and pin schema.
- Add request logging + minimal metrics.
