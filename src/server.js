#!/usr/bin/env node
// import { Server } from "@modelcontextprotocol/sdk/server";
import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initSchema, createEvent as dbCreate, listEvents as dbList, getEvent as dbGet, updateEvent as dbUpdate, deleteEvent as dbDelete, listSessions as dbListSessions, closePool } from "./db.js";

import { randomUUID } from "node:crypto"

// this function ensures a valid Date object or throws
function toDate(value, fieldName) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`Invalid ${fieldName}; expected ISO 8601 string.`);
    err.code = "INVALID_ARGUMENT";
    throw err;
  }
  return d;
}

// Ensure that event end is after start
function validateEventTimes(start, end) {
  if (end <= start) {
    const err = new Error("'end' must be after 'start'.");
    err.code = "INVALID_ARGUMENT";
    throw err;
  }
}


// Serialize event DB object to API representation
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

// const server = new Server(
//   {
//     name: "calendar-mcp",
//     version: "0.1.0",
//   },
//   {
//     capabilities: {
//       tools: {},
//     },
//   }
// );

const server = new McpServer(
  {
    name: "calendar-mcp-server",
    version: "0.1.0",
  });

// Initialize DB schema before handling tools
await initSchema();

// Compatibility: register tools using SDK APIs if available; otherwise
// fall back to request-schema-based registration by discovering schemas at runtime.
// async function resolveToolSchemas() {
//   const candidateModules = [
//     "@modelcontextprotocol/sdk/types.js",
//     "@modelcontextprotocol/sdk/types",
//     "@modelcontextprotocol/sdk/server/types.js",
//     "@modelcontextprotocol/sdk/server/types",
//     "@modelcontextprotocol/sdk/shared/protocol.js",
//     "@modelcontextprotocol/sdk/dist/esm/shared/protocol.js",
//   ];
//   for (const mod of candidateModules) {
//     try {
//       const m = await import(mod);
//       const values = Object.values(m);
//       const findByMethod = (method) =>
//         values.find((v) => v && v.shape && v.shape.method && v.shape.method.value === method);
//       const listSchema = findByMethod("tools/list");
//       const callSchema = findByMethod("tools/call");
//       if (listSchema && callSchema) return { listSchema, callSchema };
//     } catch {}
//   }
//   return null;
// }

// Local registry for tools if SDK registration methods are not available
const toolRegistry = new Map();

// Track whether we've already wired up schema handlers
let schemasWired = false;

// Attempt to set schema handler using any known method
// function setSchemaHandler(schema, handler) {
//   for (const method of ["setRequestHandler", "addRequestHandler", "onRequest"]) {
//     const fn = server?.[method];
//     if (typeof fn === "function") {
//       fn.call(server, schema, handler);
//       return true;
//     }
//   }
//   return false;
// }

/**
 * Ensures that the schema handlers for tool listing and tool invocation are set up.
 *
 * This function checks if the schema handlers have already been wired. If not, it resolves the tool schemas,
 * sets up handlers for listing available tools and calling a specific tool, and marks the schemas as wired.
 *
 * @async
 * @returns {Promise<boolean>} Returns true if the schema handlers are successfully set up or already wired, false otherwise.
 */
// async function ensureSchemaFallback() {
//   if (schemasWired) return true;
//   const schemas = await resolveToolSchemas();
//   if (!schemas) return false;
//   const ok1 = setSchemaHandler(schemas.listSchema, async () => {
//     const tools = Array.from(toolRegistry.values()).map((t) => ({
//       name: t.name,
//       description: t.description,
//       inputSchema: t.inputSchema,
//     }));
//     return { tools };
//   });
//   const ok2 = setSchemaHandler(schemas.callSchema, async (req) => {
//     const p = req?.params ?? req ?? {};
//     const name = p.name ?? p.tool ?? p.toolName;
//     const args = p.arguments ?? p.args ?? p.input ?? {};
//     const t = toolRegistry.get(name);
//     if (!t) {
//       const err = new Error(`Tool not found: ${name}`);
//       err.code = "NOT_FOUND";
//       throw err;
//     }
//     return await t.handler({ input: args });
//   });
//   schemasWired = ok1 && ok2;
//   return schemasWired;
// }


/**
 * Registers a tool with the server or local registry, attempting multiple registration methods for compatibility.
 *
 * Tries to register the tool using various server methods (`tool`, `addTool`, `registerTool`) with different argument shapes.
 * If none succeed, falls back to registering the tool in a local registry and ensures schema handlers are set up.
 *
 * @param {string} name - The unique name of the tool to register.
 * @param {Object} schema - The schema object describing the tool, including `description` and `inputSchema`.
 * @param {Function} handler - The function that implements the tool's behavior.
 */
// const registerTool = (name, schema, handler) => {
//   const def = { name, description: schema.description, inputSchema: schema.inputSchema };
//   const tryCall = (method, args) => {
//     const fn = server?.[method];
//     if (typeof fn === "function") {
//       try {
//         return fn.apply(server, args);
//       } catch {}
//     }
//     return undefined;
//   };
//   if (tryCall("tool", [name, schema, handler])) return;
//   if (tryCall("tool", [def, handler])) return;
//   if (tryCall("addTool", [name, schema, handler])) return;
//   if (tryCall("addTool", [def, handler])) return;
//   if (tryCall("registerTool", [name, schema, handler])) return;
//   if (tryCall("registerTool", [def, handler])) return;
//   // Fallback path: register into local registry and ensure schema handlers
//   toolRegistry.set(name, { name, description: schema.description, inputSchema: schema.inputSchema, handler });
//   // Trigger async wiring; top-level await is already used above so we can rely on it
//   // but we won't block registration since handlers will be present by first call/list.
//   ensureSchemaFallback();
// };

// example to register a tool for mcp
// Async tool with external API call
// server.registerTool(
//   "fetch-weather",
//   {
//     title: "Weather Fetcher",
//     description: "Get weather data for a city",
//     inputSchema: { city: z.string() }
//   },
//   async ({ city }) => {
//     const response = await fetch(`https://api.weather.com/${city}`);
//     const data = await response.text();
//     return {
//       content: [{ type: "text", text: data }]
//     };
//   }
// );

// create_event
server.registerTool(
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

    const id = randomUUID();
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
server.registerTool(
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
server.registerTool(
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
server.registerTool(
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
server.registerTool(
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
server.registerTool(
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

/**
 * Sets up graceful shutdown handlers for the process.
 *
 * Listens for SIGINT (Ctrl+C) and SIGTERM (termination) signals.
 * When either signal is received, attempts to close the database connection pool
 * by calling `closePool()`, then exits the process cleanly.
 */
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try { await closePool(); } catch {}
    process.exit(0);
  });
}
