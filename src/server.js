#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initSchema, createEvent as dbCreate, listEvents as dbList, getEvent as dbGet, updateEvent as dbUpdate, deleteEvent as dbDelete, listSessions as dbListSessions, closePool } from "./db.js";

function toDate(value, fieldName) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`Invalid ${fieldName}; expected ISO 8601 string.`);
    err.code = "INVALID_ARGUMENT";
    throw err;
  }
  return d;
}

function validateEventTimes(start, end) {
  if (end <= start) {
    const err = new Error("'end' must be after 'start'.");
    err.code = "INVALID_ARGUMENT";
    throw err;
  }
}

function serializeEvent(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? null,
    location: event.location ?? null,
    attendees: event.attendees ?? [],
    start: new Date(event.start).toISOString(),
    end: new Date(event.end).toISOString(),
    status: event.status ?? "confirmed",
    createdAt: new Date(event.created_at ?? event.createdAt).toISOString(),
    updatedAt: new Date(event.updated_at ?? event.updatedAt).toISOString(),
  };
}

// DB-backed utility: obtain events in range handled in SQL layer

const server = new Server(
  {
    name: "calendar-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize DB schema before handling tools
await initSchema();

// Compatibility: support different SDK tool registration names and signatures
const registerTool = (name, schema, handler) => {
  const def = {
    name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  };
  const candidates = [
    ["tool", [name, schema, handler]],
    ["tool", [def, handler]],
    ["addTool", [name, schema, handler]],
    ["addTool", [def, handler]],
    ["registerTool", [name, schema, handler]],
    ["registerTool", [def, handler]],
  ];
  for (const [method, args] of candidates) {
    const fn = server?.[method];
    if (typeof fn === "function") {
      try {
        return fn.apply(server, args);
      } catch (_) {
        // try next signature
      }
    }
  }
  throw new Error(
    "MCP SDK: no compatible tool registration method/signature found (tried tool/addTool/registerTool)"
  );
};

// create_event
registerTool(
  "create_event",
  {
    description: "Create a calendar event in a given session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session identifier (per user/agent)." },
        title: { type: "string", description: "Title of the event." },
        start: { type: "string", description: "Start datetime (ISO 8601)." },
        end: { type: "string", description: "End datetime (ISO 8601)." },
        description: { type: "string" },
        location: { type: "string" },
        attendees: { type: "array", items: { type: "string" } },
        status: { type: "string", enum: ["confirmed", "tentative", "cancelled"] },
      },
      required: ["session_id", "title", "start", "end"],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    const sessionId = input.session_id;
    const start = toDate(input.start, "start");
    const end = toDate(input.end, "end");
    validateEventTimes(start, end);

    const id = globalThis.crypto?.randomUUID?.() || (await import("node:crypto")).randomUUID();
    const now = new Date();
    const event = {
      id,
      session_id: sessionId,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      attendees: Array.isArray(input.attendees) ? input.attendees : [],
      start: start.toISOString(),
      end: end.toISOString(),
      status: input.status ?? "confirmed",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    await dbCreate(event);
    return {
      content: [
        {
          type: "json",
          json: serializeEvent(event),
        },
      ],
    };
  }
);

// list_events
registerTool(
  "list_events",
  {
    description: "List events for a session, optionally filtering by a time range.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        range_start: { type: "string", description: "Inclusive range start (ISO 8601)." },
        range_end: { type: "string", description: "Inclusive range end (ISO 8601)." },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    const events = await dbList(
      input.session_id,
      input.range_start ? toDate(input.range_start, "range_start").toISOString() : undefined,
      input.range_end ? toDate(input.range_end, "range_end").toISOString() : undefined
    );
    return { content: [{ type: "json", json: events.map(serializeEvent) }] };
  }
);

// get_event
registerTool(
  "get_event",
  {
    description: "Get a single event by ID within a session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        event_id: { type: "string" },
      },
      required: ["session_id", "event_id"],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    const event = await dbGet(input.session_id, input.event_id);
    if (!event) {
      const err = new Error("Event not found.");
      err.code = "NOT_FOUND";
      throw err;
    }
    return { content: [{ type: "json", json: serializeEvent(event) }] };
  }
);

// update_event
registerTool(
  "update_event",
  {
    description: "Update fields on an existing event.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        event_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        attendees: { type: "array", items: { type: "string" } },
        start: { type: "string" },
        end: { type: "string" },
        status: { type: "string", enum: ["confirmed", "tentative", "cancelled"] },
      },
      required: ["session_id", "event_id"],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    const existing = await dbGet(input.session_id, input.event_id);
    if (!existing) {
      const err = new Error("Event not found.");
      err.code = "NOT_FOUND";
      throw err;
    }

    const next = { ...existing };
    if (input.title !== undefined) next.title = input.title;
    if (input.description !== undefined) next.description = input.description;
    if (input.location !== undefined) next.location = input.location;
    if (input.attendees !== undefined) next.attendees = Array.isArray(input.attendees) ? input.attendees : [];
    if (input.start !== undefined) next.start = toDate(input.start, "start").toISOString();
    if (input.end !== undefined) next.end = toDate(input.end, "end").toISOString();
    if (input.status !== undefined) next.status = input.status;

    validateEventTimes(new Date(next.start), new Date(next.end));

    const patch = {};
    if (input.title !== undefined) patch.title = next.title;
    if (input.description !== undefined) patch.description = next.description;
    if (input.location !== undefined) patch.location = next.location;
    if (input.attendees !== undefined) patch.attendees = next.attendees;
    if (input.start !== undefined) patch.start = next.start;
    if (input.end !== undefined) patch.end = next.end;
    if (input.status !== undefined) patch.status = next.status;

    const updated = await dbUpdate(input.session_id, input.event_id, patch);
    return { content: [{ type: "json", json: serializeEvent(updated) }] };
  }
);

// delete_event
registerTool(
  "delete_event",
  {
    description: "Delete an event by ID within a session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        event_id: { type: "string" },
      },
      required: ["session_id", "event_id"],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    const success = await dbDelete(input.session_id, input.event_id);
    return { content: [{ type: "json", json: { success } }] };
  }
);

// list_sessions (utility)
registerTool(
  "list_sessions",
  {
    description: "List all session IDs currently in memory.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  async () => {
    const ids = await dbListSessions();
    return { content: [{ type: "json", json: ids }] };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try { await closePool(); } catch {}
    process.exit(0);
  });
}
