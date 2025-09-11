# Calendar MCP Server

An MCP (Model Context Protocol) server that provides a session‑scoped calendar service for AI agents. Agents pass a `session_id` to keep events separate for different users or conversations. Data is persisted in PostgreSQL. This project is entirely made by Vibe Coding.

**Why This Exists**
- **Session isolation:** separate calendars per `session_id`.
- **Straightforward CRUD:** create, list, get, update, delete.
- **Portable runtime:** Node.js over stdio; easy Docker/Compose.

**Architecture**
- **Runtime:** Node.js (>= 18)
- **Protocol:** MCP over stdio (`@modelcontextprotocol/sdk` 1.x)
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
  - `npm start`

The server speaks MCP over stdio and is typically launched by an MCP‑capable client (Claude Desktop or other MCP‑compatible tools). Ensure PostgreSQL is reachable via `DATABASE_URL` or `PG*` env vars.

**Example MCP Client Config**
```json
{
  "mcpServers": {
    "calendar": {
      "command": "node",
      "args": ["src/server.js"],
      "env": {}
    }
  }
}
```

**Docker**
- Build: `docker build -t calendar-mcp:latest .`
- Run (stdio):
  - `docker run --rm -i -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/calendar_mcp calendar-mcp:latest`

Most MCP clients spawn the server directly. If your client supports containers, point it at the `docker run ...` command above.

**Docker Compose (Dev)**
- Start both DB and server:
  - `docker compose up --build`
- Services:
  - **db:** `postgres:16-alpine`, credentials `postgres/postgres`, DB `calendar_mcp`. Health‑checked via `pg_isready`. Not exposed on the host by default.
  - **server:** calendar MCP server configured with `DATABASE_URL` pointing to `db`.
- Host access to Postgres (optional):
  - Add a non‑conflicting mapping, e.g. `ports: ["55432:5432"]`, then connect via `localhost:55432`.

**Portainer / Remote Git Builds**
- The Dockerfile is lockfile‑aware and resilient, but builders must reach npmjs.
- If your environment uses a mirror/proxy, set the build arg:
  - In Compose: under `server.build.args`: `NPM_REGISTRY: https://registry.npmjs.org/`
- For deterministic installs, generate and commit a `package-lock.json` locally so builds use `npm ci`.

**Troubleshooting**
- **Port in use (5432):** Another service is using host 5432. Either remove the mapping (containers can talk via the Compose network) or map a different host port (e.g. `55432:5432`).
- **DB not ready (ECONNREFUSED):** The server waits on DB health via Compose. If you still see refusal, check `docker compose ps` (db should be `healthy`) and logs for both services.
- **npm ETARGET (version not found):** Ensure you depend on a published SDK version (this repo uses `@modelcontextprotocol/sdk@^1.17.5`). If using Portainer with a proxy/mirror, set `NPM_REGISTRY` build arg so the builder can reach npmjs.

**Roadmap Ideas**
- Migrations (Prisma, node‑pg‑migrate)
- ICS import/export, recurring events, reminders
- Conflict detection and availability queries
- Auth and multi‑tenant hardening for network transports

**Attribution**
This project is entirely made by Vibe Coding.
