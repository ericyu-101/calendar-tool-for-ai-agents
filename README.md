# Calendar Tool for AI Agents

A lightweight REST API for a session‑scoped calendar service backed by PostgreSQL. Your AI agent can call this over HTTP to create, list, read, update, and delete events in a given `session_id`.

You can also wrap these API endpoints into an MCP server and connect them to your AI agent of choice. Since this tool is designed to work with AI agents built with n8n, a simple REST API server is the most straightforward method for integration.

Architecture
- Runtime: Node.js (>= 18)
- Protocol: HTTP/JSON (no external web framework)
- Storage: PostgreSQL (events keyed by `session_id`)
- Validation: ISO 8601 datetimes; `end` must be after `start`

## Getting Started (Local)
- Prerequisites: Node.js 18+
- Start Postgres in Docker first (see "Local Postgres (Docker)" below).
- Configure environment and run the API:
  - `export DATABASE_URL="postgres://postgres:postgres@localhost:5432/calendar_db"`
  - `npm install`
  - `npm start` (listens on `PORT` or `3000`)

Local Test Script
- Run the CRUD smoke test via the npm wrapper (calls `scripts/test-local.sh` under the hood):
  - `npm test` (defaults to session `test-123`)
- Optional arguments:
  - Use a custom session: `npm test -- my-session`
  - Target a different URL: `BASE_URL=http://127.0.0.1:3000 npm test`
- You can still execute the Bash script directly if you prefer: `bash scripts/test-local.sh …`
- Prerequisites: Postgres running and API started (see sections above).

Local Postgres (Docker)
- Start a local Postgres 16 instance on `localhost:5432` matching the compose settings:

  ```bash
  docker run -d --name calendar_db --restart unless-stopped \
    -p 5432:5432 \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=calendar_db \
    --health-cmd='pg_isready -U postgres' \
    --health-interval=3s \
    --health-timeout=3s \
    --health-retries=20 \
    postgres:16-alpine
  ```
- Then set `DATABASE_URL` as shown above to point at `localhost:5432`.
- Stop/remove when done: `docker stop calendar_db && docker rm calendar_db`

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
- Build: `docker build -t calendar-tool-for-ai-agents:latest .`
- Run: `docker run --rm -p 3000:3000 -e PORT=3000 -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/calendar_db calendar-tool-for-ai-agents:latest`
- Multi-arch push (replace `your-dockerhub-user` and `tag`):
  ```bash
  docker buildx build --platform linux/amd64,linux/arm64,windows/amd64 \
    -t your-dockerhub-user/calendar-server:tag --push .
  ```

## Getting Started with Docker Compose (Dev)
- Ensure the shared stack network exists (only needs to be created once):
  - `docker network create shared_network`
- `docker compose up --build`
- Services:
  - db: Postgres 16 (user/pass `postgres/postgres`, DB `calendar_mcp`)
  - api: REST API, waits on db health; configure `DATABASE_URL` to point at `db`.
    - Example: `DATABASE_URL=postgres://postgres:postgres@db:5432/calendar_db`
- Networking:
  - Internal traffic (API ↔ DB) stays on the private bridge network declared in compose.
  - The API also joins the shared `shared_network` so other containers in the stack can call it.
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

Project History
- Originally shipped as an MCP server that streamed responses over HTTP SSE.
- Refactored to a REST API to deliver a more stable surface for agent integrations while retaining the same data model and Postgres storage.

Why this refactor: previously this project implemented MCP over HTTP SSE. To avoid churn from evolving MCP specs, this version exposes a stable REST API surface while keeping the same data model and Postgres storage.
