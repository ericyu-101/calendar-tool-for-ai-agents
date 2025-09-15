# Calendar MCP Server

An MCP (Model Context Protocol) server that provides a session‑scoped calendar service for AI agents. Agents pass a `session_id` to keep events separate for different users or conversations. Data is persisted in PostgreSQL. This project is entirely made by Vibe Coding.

What is MCP? See the Model Context Protocol overview: https://modelcontextprotocol.io/about/index

**Why This Exists**
- **Session isolation:** separate calendars per `session_id`.
- **Straightforward CRUD:** create, list, get, update, delete.
- **Portable runtime:** Node.js over stdio; easy Docker/Compose.

**Architecture**
- **Runtime:** Node.js (>= 18)
- **Protocol:** MCP over HTTP SSE (`@modelcontextprotocol/sdk` 1.x)
  - Endpoints: `GET /sse` (open stream), `POST /messages?sessionId=...` (send)
  - Works with MCP clients that support HTTP SSE transports.
- **Storage:** PostgreSQL (events keyed by `session_id`)
- **Tools:**
  - `create_event(session_id, title, start, end, description?, location?, attendees?, status?)`
  - `list_events(session_id, range_start?, range_end?)`
  - `get_event(session_id, event_id)`
  - `update_event(session_id, event_id, ...)`
  - `delete_event(session_id, event_id)`
  - `list_sessions()`

Event fields: `id`, `session_id`, `title`, `description?`, `location?`, `attendees[]`, `start`, `end`, `status`, `createdAt`, `updatedAt`.

Notes:
- **Validation:** `start`/`end` must be ISO 8601; `end` > `start`.
- **Schema:** auto‑initialized at startup.

**Getting Started (Local)**
- Prerequisites: Node.js 18+
- Example:
  - `export DATABASE_URL="postgres://postgres:postgres@localhost:5432/calendar_mcp"`
  - `npm install`
  - `npm start` (listens on `PORT` or `3000`)

This server exposes MCP over HTTP SSE on `http://localhost:3000`. Ensure PostgreSQL is reachable via `DATABASE_URL` or `PG*` env vars.

**How MCP Works (at a glance)**
- Choose MCP servers: pick prebuilt servers or build your own.
- Connect your AI application: point the client at the server.
- Work with context: use tools/resources exposed by connected servers.

Learn more about MCP clients: https://modelcontextprotocol.io/clients

**Connecting From Clients (HTTP SSE)**
- ChatGPT and other HTTP‑capable MCP clients: add a connection with base URL `http://localhost:3000`.
- Some clients only support spawning stdio commands; those will not work with this HTTP‑only server.
- Confirm your client supports HTTP SSE transports before connecting.

**Docker**
- Build: `docker build -t calendar-mcp:latest .`
- Run (HTTP SSE):
  - `docker run --rm -p 3000:3000 -e PORT=3000 -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/calendar_mcp calendar-mcp:latest`

Point HTTP‑capable MCP clients at `http://localhost:3000` (or your host/port).

**Docker Compose (Dev)**
- Start both DB and server:
  - `docker compose up --build`
- Services:
  - **db:** `postgres:16-alpine`, credentials `postgres/postgres`, DB `calendar_mcp`. Health‑checked via `pg_isready`. Not exposed on the host by default.
  - **server:** calendar MCP server configured with `DATABASE_URL` pointing to `db`.
- Host access to Postgres (optional):
  - Add a non‑conflicting mapping, e.g. `ports: ["55432:5432"]`, then connect via `localhost:55432`.
 - Expose HTTP port (optional):
   - Under `service`, add `ports: ["3000:3000"]` to access the SSE endpoint from your host.

**Portainer / Remote Git Builds**
- The Dockerfile is lockfile‑aware and resilient, but builders must reach npmjs.
- If your environment uses a mirror/proxy, set the build arg:
  - In Compose: under `server.build.args`: `NPM_REGISTRY: https://registry.npmjs.org/`
- For deterministic installs, generate and commit a `package-lock.json` locally so builds use `npm ci`.

**Troubleshooting**
- **Port in use (5432):** Another service is using host 5432. Either remove the mapping (containers can talk via the Compose network) or map a different host port (e.g. `55432:5432`).
- **DB not ready (ECONNREFUSED):** The server waits on DB health via Compose. If you still see refusal, check `docker compose ps` (db should be `healthy`) and logs for both services.
- **npm ETARGET (version not found):** Ensure you depend on a published SDK version (this repo uses `@modelcontextprotocol/sdk@^1.17.5`). If using Portainer with a proxy/mirror, set `NPM_REGISTRY` build arg so the builder can reach npmjs.
- **Client can’t connect:** Verify your client supports HTTP SSE transports. For stdio‑only clients (e.g., some desktop IDE integrations), this server won’t appear.

**Roadmap Ideas**
- Migrations (Prisma, node‑pg‑migrate)
- ICS import/export, recurring events, reminders
- Conflict detection and availability queries
- Auth and multi‑tenant hardening for network transports

**Compatible Clients**
- Many clients support MCP; feature coverage varies (tools/resources/prompts/roots).
- See the up‑to‑date client list and feature matrix: https://modelcontextprotocol.io/clients

**Attribution**
This project is entirely made by Vibe Coding.
