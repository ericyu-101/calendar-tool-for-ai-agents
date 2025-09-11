import { Pool } from "pg";

function env(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

const databaseUrl = env("DATABASE_URL");

const pool = new Pool(
  databaseUrl
    ? { connectionString: databaseUrl }
    : {
        host: env("PGHOST", "localhost"),
        port: Number(env("PGPORT", 5432)),
        user: env("PGUSER", "postgres"),
        password: env("PGPASSWORD", "postgres"),
        database: env("PGDATABASE", "calendar_mcp"),
        ssl: env("PGSSL", "false") === "true" ? { rejectUnauthorized: false } : undefined,
      }
);

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

export async function getEvent(sessionId, eventId) {
  const { rows } = await pool.query(
    `SELECT * FROM events WHERE session_id = $1 AND id = $2`,
    [sessionId, eventId]
  );
  return rows[0] || null;
}

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

export async function deleteEvent(sessionId, eventId) {
  const { rowCount } = await pool.query(
    `DELETE FROM events WHERE session_id = $1 AND id = $2`,
    [sessionId, eventId]
  );
  return rowCount > 0;
}

export async function listSessions() {
  const { rows } = await pool.query(`SELECT DISTINCT session_id FROM events ORDER BY session_id ASC`);
  return rows.map((r) => r.session_id);
}

export async function closePool() {
  await pool.end();
}

