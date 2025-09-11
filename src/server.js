#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";

// Simple in-memory store: sessionId -> (eventId -> event)
const sessions = new Map();

function ensureSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Map());
  }
  return sessions.get(sessionId);
}

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
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    status: event.status ?? "confirmed",
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

function listEventsInRange(store, rangeStart, rangeEnd) {
  const events = Array.from(store.values()).map(serializeEvent);
  if (!rangeStart && !rangeEnd) return events.sort((a, b) => a.start.localeCompare(b.start));

  const rs = rangeStart ? toDate(rangeStart, "range_start") : null;
  const re = rangeEnd ? toDate(rangeEnd, "range_end") : null;

  const filtered = events.filter((e) => {
    const s = new Date(e.start);
    const en = new Date(e.end);
    if (rs && en < rs) return false;
    if (re && s > re) return false;
    return true;
  });
  return filtered.sort((a, b) => a.start.localeCompare(b.start));
}

function requireSessionAndEvent(sessionId, eventId) {
  const store = sessions.get(sessionId);
  if (!store) {
    const err = new Error("Session not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  const event = store.get(eventId);
  if (!event) {
    const err = new Error("Event not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  return { store, event };
}

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

// create_event
server.tool(
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
    const store = ensureSession(sessionId);

    const start = toDate(input.start, "start");
    const end = toDate(input.end, "end");
    validateEventTimes(start, end);

    const id = globalThis.crypto?.randomUUID?.() || (await import("node:crypto")).randomUUID();
    const now = new Date();
    const event = {
      id,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      attendees: Array.isArray(input.attendees) ? input.attendees : [],
      start,
      end,
      status: input.status ?? "confirmed",
      createdAt: now,
      updatedAt: now,
    };
    store.set(event.id, event);

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
server.tool(
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
    const store = ensureSession(input.session_id);
    const events = listEventsInRange(store, input.range_start, input.range_end);
    return { content: [{ type: "json", json: events }] };
  }
);

// get_event
server.tool(
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
    const { event } = requireSessionAndEvent(input.session_id, input.event_id);
    return { content: [{ type: "json", json: serializeEvent(event) }] };
  }
);

// update_event
server.tool(
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
    const { store, event } = requireSessionAndEvent(input.session_id, input.event_id);

    if (input.title !== undefined) event.title = input.title;
    if (input.description !== undefined) event.description = input.description;
    if (input.location !== undefined) event.location = input.location;
    if (input.attendees !== undefined) event.attendees = Array.isArray(input.attendees) ? input.attendees : [];
    if (input.start !== undefined) event.start = toDate(input.start, "start");
    if (input.end !== undefined) event.end = toDate(input.end, "end");
    if (input.status !== undefined) event.status = input.status;

    validateEventTimes(event.start, event.end);
    event.updatedAt = new Date();
    store.set(event.id, event);

    return { content: [{ type: "json", json: serializeEvent(event) }] };
  }
);

// delete_event
server.tool(
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
    const store = ensureSession(input.session_id);
    const existed = store.delete(input.event_id);
    return { content: [{ type: "json", json: { success: existed } }] };
  }
);

// list_sessions (utility)
server.tool(
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
    return { content: [{ type: "json", json: Array.from(sessions.keys()) }] };
  }
);

const transport = new StdioServerTransport();
server.connect(transport);

