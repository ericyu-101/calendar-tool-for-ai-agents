# Calendar REST Server

A lightweight REST API for a session‑scoped calendar service backed by PostgreSQL. Your AI agent can call this over HTTP to create, list, read, update, and delete events in a given `session_id`.

Why this refactor: previously this project implemented MCP over HTTP SSE. To avoid churn from evolving MCP specs, this version exposes a stable REST API surface while keeping the same data model and Postgres storage.

Architecture
- Runtime: Node.js (>= 18)
- Protocol: HTTP/JSON (no external web framework)
- Storage: PostgreSQL (events keyed by `session_id`)
- Validation: ISO 8601 datetimes; `end` must be after `start`

Getting Started (Local)
- Prerequisites: Node.js 18+, PostgreSQL
- Example:
  - `export DATABASE_URL="postgres://postgres:postgres@localhost:5432/calendar_mcp"`
  - `npm install`
  - `npm start` (listens on `PORT` or `3000`)

Health Check
- `GET /health` -> `{ "ok": true }`

REST API
- `GET /sessions`
  - Returns an array of known session IDs.

- `POST /sessions/:sessionId/events`
  - Body: `{ title, start, end, description?, location?, attendees?: string[], status?: "confirmed"|"tentative"|"cancelled" }`
  - Creates an event and returns the created event object.

- `GET /sessions/:sessionId/events?range_start=ISO&range_end=ISO`
  - Lists events for a session, optionally filtered by a time range.

- `GET /sessions/:sessionId/events/:eventId`
  - Returns a single event or 404 if not found.

- `PATCH /sessions/:sessionId/events/:eventId`
  - Body (any subset): `{ title?, description?, location?, attendees?, start?, end?, status? }`
  - Partially updates an event and returns the updated event.

- `DELETE /sessions/:sessionId/events/:eventId`
  - Deletes the event. Returns `{ success: boolean }`.

Event JSON
- `{ id, title, description, location, attendees[], start, end, status, createdAt, updatedAt }`
  - All datetime fields are ISO 8601 strings.

Docker
- Build: `docker build -t calendar-rest:latest .`
- Run: `docker run --rm -p 3000:3000 -e PORT=3000 -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/calendar_mcp calendar-rest:latest`

Docker Compose (Dev)
- `docker compose up --build`
- Services:
  - db: Postgres 16 (user/pass `postgres/postgres`, DB `calendar_mcp`)
  - api: REST API, waits on db health; configure `DATABASE_URL` to point at `db`.
- Optional host Postgres port: add `ports: ["55432:5432"]` under `db`.
- Optional API port: add `ports: ["3000:3000"]` under `api`.

Troubleshooting
- DB not ready: check `docker compose ps` and logs. The `db` service should be healthy.
- Connection string: ensure `DATABASE_URL` or `PG*` env vars are set correctly.
- Invalid JSON: server returns 400 `{ error: "Invalid JSON body" }`.
- Date validation: server returns 400 if dates are not ISO 8601 or if `end` <= `start`.

Roadmap Ideas
- Auth (API keys, JWT), rate limiting, CORS
- Migrations (Prisma or node‑pg‑migrate)
- ICS import/export, recurring events, reminders
- Availability queries and conflict detection

Attribution
This project started as an MCP server and was refactored to REST to prioritize stability for agent integrations.
