#!/usr/bin/env node
import { initSchema, createEvent as dbCreate, listEvents as dbList, getEvent as dbGet, updateEvent as dbUpdate, deleteEvent as dbDelete, listSessions as dbListSessions, closePool } from "./db.js";
import { createServer } from "node:http";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";

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

// Initialize DB schema at startup
await initSchema();

// Utility: send JSON
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

// Utility: read JSON body (for POST/PATCH)
async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try { return JSON.parse(body); } catch {
    const err = new Error("Invalid JSON body");
    err.code = "INVALID_JSON";
    throw err;
  }
}

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try { await closePool(); } catch {}
    process.exit(0);
  });
}

const httpPort = Number(process.env.PORT || 3000);
const httpServer = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    return sendJson(res, 400, { error: "Bad Request" });
  }

  const url = new URL(req.url, `http://localhost:${httpPort}`);
  const parts = url.pathname.split("/").filter(Boolean);

  // Simple health
  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  try {
    // GET /sessions -> list session IDs
    if (req.method === "GET" && parts.length === 1 && parts[0] === "sessions") {
      const ids = await dbListSessions();
      return sendJson(res, 200, ids);
    }

    // /sessions/:sessionId/events
    if (parts.length >= 3 && parts[0] === "sessions" && parts[2] === "events") {
      const sessionId = parts[1];

      // POST /sessions/:sessionId/events -> create event
      if (req.method === "POST" && parts.length === 3) {
        const input = await readJson(req);
        if (!input || !input.title || !input.start || !input.end) {
          return sendJson(res, 400, { error: "Missing required fields: title, start, end" });
        }

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
        return sendJson(res, 201, serializeEvent(event));
      }

      // GET /sessions/:sessionId/events -> list events (optional range)
      if (req.method === "GET" && parts.length === 3) {
        const rangeStart = url.searchParams.get("range_start");
        const rangeEnd = url.searchParams.get("range_end");
        const events = await dbList(
          sessionId,
          rangeStart ? toDate(rangeStart, "range_start").toISOString() : undefined,
          rangeEnd ? toDate(rangeEnd, "range_end").toISOString() : undefined
        );
        return sendJson(res, 200, events.map(serializeEvent));
      }

      // /sessions/:sessionId/events/:eventId
      if (parts.length === 4) {
        const eventId = parts[3];

        // GET -> fetch one
        if (req.method === "GET") {
          const event = await dbGet(sessionId, eventId);
          if (!event) return sendJson(res, 404, { error: "Event not found" });
          return sendJson(res, 200, serializeEvent(event));
        }

        // PATCH -> partial update
        if (req.method === "PATCH") {
          const input = await readJson(req);
          const existing = await dbGet(sessionId, eventId);
          if (!existing) return sendJson(res, 404, { error: "Event not found" });

          const next = { ...existing };
          if (input.title !== undefined) next.title = input.title;
          if (input.description !== undefined) next.description = input.description;
          if (input.location !== undefined) next.location = input.location;
          if (input.attendees !== undefined) next.attendees = Array.isArray(input.attendees) ? input.attendees : [];
          if (input.start !== undefined) next.start = toDate(input.start, "start").toISOString();
          if (input.end !== undefined) next.end = toDate(input.end, "end").toISOString();
          if (input.status !== undefined) next.status = input.status;

          // If either start/end provided, ensure order
          validateEventTimes(new Date(next.start), new Date(next.end));

          const patch = {};
          if (input.title !== undefined) patch.title = next.title;
          if (input.description !== undefined) patch.description = next.description;
          if (input.location !== undefined) patch.location = next.location;
          if (input.attendees !== undefined) patch.attendees = next.attendees;
          if (input.start !== undefined) patch.start = next.start;
          if (input.end !== undefined) patch.end = next.end;
          if (input.status !== undefined) patch.status = next.status;

          const updated = await dbUpdate(sessionId, eventId, patch);
          return sendJson(res, 200, serializeEvent(updated));
        }

        // DELETE -> delete
        if (req.method === "DELETE") {
          const success = await dbDelete(sessionId, eventId);
          return sendJson(res, 200, { success });
        }
      }
    }

    // Not found
    return sendJson(res, 404, { error: "Not Found" });
  } catch (err) {
    const status = err?.code === "INVALID_ARGUMENT" || err?.code === "INVALID_JSON" ? 400 : 500;
    return sendJson(res, status, { error: err?.message || "Server Error" });
  }
});

httpServer.listen(httpPort, () => {
  // eslint-disable-next-line no-console
  console.log(`REST server listening on :${httpPort}`);
});
