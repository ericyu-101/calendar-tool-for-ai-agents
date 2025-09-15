import { Pool } from "pg";

/**
 * Read an environment variable with an optional fallback.
 * @param {string} name - Environment variable name.
 * @param {string|undefined} [fallback] - Value to use when the variable is unset.
 * @returns {string|undefined} The environment value or the provided fallback.
 */
function env(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

const databaseUrl = env("DATABASE_URL");

/**
 * Initialize a singleton PostgreSQL connection pool.
 * Uses `DATABASE_URL` when present; otherwise falls back to discrete `PG*` env vars
 * (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSL). This pool is shared
 * by all DB operations for efficient connection reuse.
 */
const pool = new Pool(
  databaseUrl
    ? { connectionString: databaseUrl }
    : {
        host: env("PGHOST", "localhost"),
        port: Number(env("PGPORT", 5432)),
        user: env("PGUSER", "postgres"),
        password: env("PGPASSWORD", "postgres"),
        database: env("PGDATABASE", "calendar_db"),
        ssl: env("PGSSL", "false") === "true" ? { rejectUnauthorized: false } : undefined,
      }
);

/**
 * Ensure the database schema exists.
 * Creates the `events` table and supporting indexes if they do not already exist.
 * Safe to call multiple times; operations are idempotent.
 */
export async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        location TEXT,
        attendees TEXT[] NOT NULL DEFAULT '{}',
        start TIMESTAMPTZ NOT NULL,
        "end" TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_session_start ON events(session_id, start);
    `);
  } finally {
    client.release();
  }
}

/**
 * Event row as stored in the database.
 * Datetime fields are `timestamptz` and are typically returned as JS `Date` by `pg`.
 * @typedef {Object} DbEventRow
 * @property {string} id - Event UUID.
 * @property {string} session_id - Session/tenant identifier.
 * @property {string} title - Event title.
 * @property {string|null} [description] - Optional description.
 * @property {string|null} [location] - Optional location.
 * @property {string[]} attendees - List of attendee identifiers or emails.
 * @property {Date} start - Start datetime (UTC recommended).
 * @property {Date} end - End datetime (must be after start).
 * @property {string} status - Status string (e.g., 'confirmed').
 * @property {Date} created_at - Creation timestamp.
 * @property {Date} updated_at - Last update timestamp.
 */

/**
 * Event payload used when creating an event.
 * Datetime inputs may be ISO strings or `Date` instances.
 * @typedef {Object} NewEvent
 * @property {string} id
 * @property {string} session_id
 * @property {string} title
 * @property {string|null} [description]
 * @property {string|null} [location]
 * @property {string[]} attendees
 * @property {string|Date} start
 * @property {string|Date} end
 * @property {string} status
 * @property {string|Date} created_at
 * @property {string|Date} updated_at
 */

/**
 * Create a new event record.
 * @param {NewEvent} e - Event fields to insert.
 * @returns {Promise<void>} Resolves when the insert completes.
 */
export async function createEvent(e) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO events (
        id, session_id, title, description, location, attendees, start, "end", status, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )`,
      [
        e.id,
        e.session_id,
        e.title,
        e.description,
        e.location,
        e.attendees,
        e.start,
        e.end,
        e.status,
        e.created_at,
        e.updated_at,
      ]
    );
  } finally {
    client.release();
  }
}

/**
 * List events for a session, optionally filtered by time range.
 * When both `rangeStart` and `rangeEnd` are omitted, returns all events for the session.
 * If provided, results include events where `end >= rangeStart` and `start <= rangeEnd`.
 * @param {string} sessionId - Session identifier to query.
 * @param {string|Date|undefined} [rangeStart] - Inclusive lower bound against `end`.
 * @param {string|Date|undefined} [rangeEnd] - Inclusive upper bound against `start`.
 * @returns {Promise<DbEventRow[]>} Ordered by `start` ascending.
 */
export async function listEvents(sessionId, rangeStart, rangeEnd) {
  const client = await pool.connect();
  try {
    if (!rangeStart && !rangeEnd) {
      const { rows } = await client.query(
        `SELECT * FROM events WHERE session_id = $1 ORDER BY start ASC`,
        [sessionId]
      );
      return rows;
    }
    const clauses = ["session_id = $1"]; const params = [sessionId];
    let idx = 2;
    if (rangeStart) { clauses.push(`"end" >= $${idx++}`); params.push(rangeStart); }
    if (rangeEnd) { clauses.push(`start <= $${idx++}`); params.push(rangeEnd); }
    const { rows } = await client.query(
      `SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY start ASC`,
      params
    );
    return rows;
  } finally {
    client.release();
  }
}

/**
 * Fetch a single event by session and ID.
 * @param {string} sessionId - Session identifier.
 * @param {string} eventId - Event UUID.
 * @returns {Promise<DbEventRow|null>} The event row if found; otherwise `null`.
 */
export async function getEvent(sessionId, eventId) {
  const { rows } = await pool.query(
    `SELECT * FROM events WHERE session_id = $1 AND id = $2`,
    [sessionId, eventId]
  );
  return rows[0] || null;
}

/**
 * Partially update an event and return the updated row.
 * Automatically sets `updated_at = NOW()` regardless of patch input.
 * @param {string} sessionId - Session identifier.
 * @param {string} eventId - Event UUID.
 * @param {Object} patch - Partial fields to update (e.g., `title`, `description`, `start`, `end`, `status`, etc.).
 * @returns {Promise<DbEventRow|null>} Updated row when found; otherwise `null`.
 */
export async function updateEvent(sessionId, eventId, patch) {
  // Build dynamic update
  const fields = [];
  const params = [];
  let idx = 1;
  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = $${idx++}`);
    params.push(value);
  }
  fields.push(`updated_at = NOW()`);
  const whereIdx1 = idx++, whereIdx2 = idx;
  const sql = `UPDATE events SET ${fields.join(", ")} WHERE session_id = $${whereIdx1} AND id = $${whereIdx2} RETURNING *`;
  const { rows } = await pool.query(sql, [...params, sessionId, eventId]);
  return rows[0] || null;
}

/**
 * Delete an event by session and ID.
 * @param {string} sessionId - Session identifier.
 * @param {string} eventId - Event UUID.
 * @returns {Promise<boolean>} `true` if a row was deleted; otherwise `false`.
 */
export async function deleteEvent(sessionId, eventId) {
  const { rowCount } = await pool.query(
    `DELETE FROM events WHERE session_id = $1 AND id = $2`,
    [sessionId, eventId]
  );
  return rowCount > 0;
}

/**
 * List all known session IDs that have at least one event.
 * @returns {Promise<string[]>} Sorted list of distinct session IDs.
 */
export async function listSessions() {
  const { rows } = await pool.query(`SELECT DISTINCT session_id FROM events ORDER BY session_id ASC`);
  return rows.map((r) => r.session_id);
}

/**
 * Close the shared PostgreSQL pool.
 * Intended for graceful shutdown on SIGINT/SIGTERM.
 * @returns {Promise<void>} Resolves when all connections are closed.
 */
export async function closePool() {
  await pool.end();
}
