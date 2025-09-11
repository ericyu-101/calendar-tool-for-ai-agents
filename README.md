# Calendar MCP Server

An MCP (Model Context Protocol) server that provides a session-scoped calendar service designed for AI agents. Agents pass a `session_id` to keep events separate for different users or conversations. This project is entirely made by Vibe Coding.

## Why this exists

- Session isolation: keep separate calendars per `session_id`.
- Simple, fast CRUD: create, list, get, update, delete events.
- Runs anywhere: Node.js via stdio, or containerized with Docker.

## Project Plan

1. Scaffold Node MCP server
2. Implement in-memory calendar store
3. Add CRUD tools with validation
4. Add Dockerfile and .dockerignore
5. Write README with intro and plan

## Architecture

- Runtime: Node.js (>= 18)
- Protocol: MCP over stdio (via `@modelcontextprotocol/sdk`)
- Storage: In-memory map keyed by `session_id` (per-session event maps)
- Tools:
  - `create_event(session_id, title, start, end, description?, location?, attendees?, status?)`
  - `list_events(session_id, range_start?, range_end?)`
  - `get_event(session_id, event_id)`
  - `update_event(session_id, event_id, ...)`
  - `delete_event(session_id, event_id)`
  - `list_sessions()`

Event fields: `id`, `title`, `description?`, `location?`, `attendees[]`, `start`, `end`, `status`, `createdAt`, `updatedAt`.

Notes:
- `start`/`end` must be ISO 8601 strings; `end` must be after `start`.
- This reference implementation uses in-memory storage; add a persistence layer (e.g., SQLite, Postgres) if you need durability.

## Getting Started (Local)

Prerequisites: Node.js 18+

```bash
npm install
npm start
```

The server speaks MCP over stdio and is intended to be launched by an MCP-capable client (e.g., Claude Desktop or other MCP-compatible agents).

### Example MCP client configuration

If your client supports custom MCP servers via command/args, configure something like:

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

## Docker

Build the image:

```bash
docker build -t calendar-mcp:latest .
```

Run the server (stdio mode):

```bash
docker run --rm -i calendar-mcp:latest
```

Most MCP clients expect to spawn the server directly. If your client supports running tools in containers, point it to execute `docker run --rm -i calendar-mcp:latest` as the command for the server.

## Tool Reference

- `create_event`
  - Input: `{ session_id, title, start, end, description?, location?, attendees?, status? }`
  - Output: JSON event object

- `list_events`
  - Input: `{ session_id, range_start?, range_end? }`
  - Output: JSON array of events sorted by start time

- `get_event`
  - Input: `{ session_id, event_id }`
  - Output: JSON event object

- `update_event`
  - Input: `{ session_id, event_id, ...patch }`
  - Output: JSON event object

- `delete_event`
  - Input: `{ session_id, event_id }`
  - Output: `{ success: boolean }`

- `list_sessions`
  - Input: `{}`
  - Output: `[ session_id, ... ]`

## Roadmap Ideas

- Persistence via SQLite/Postgres and migrations
- ICS import/export, recurring events, reminders
- Conflict detection and availability queries
- Authentication and multi-tenant hardening for network transports

## Attribution

This project is entirely made by Vibe Coding.

