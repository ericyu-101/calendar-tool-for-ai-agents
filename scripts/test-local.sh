#!/usr/bin/env bash

set -euo pipefail

# Simple local test script for the Calendar API.
# - Creates an event in a session
# - Extracts the created event's id
# - Lists, reads, updates, and deletes the event

BASE_URL=${BASE_URL:-"http://localhost:3000"}
SESSION_ID=${1:-"test-123"}

echo "Using BASE_URL=${BASE_URL} SESSION_ID=${SESSION_ID}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found in PATH" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd node

echo "1) Checking health..."
curl -sS "${BASE_URL}/health" || { echo "Health check failed" >&2; exit 1; }
echo

echo "2) Creating event..."
CREATE_PAYLOAD='{
  "title": "Call",
  "description": "Status sync",
  "start": "2025-01-10T09:00:00Z",
  "end": "2025-01-10T09:30:00Z"
}'

CREATE_RES=$(curl -sS -X POST "${BASE_URL}/sessions/${SESSION_ID}/events" \
  -H 'Content-Type: application/json' \
  -d "${CREATE_PAYLOAD}")

echo "Create response: ${CREATE_RES}"

EVENT_ID=$(printf '%s' "${CREATE_RES}" | node -e '
let data="";
process.stdin.on("data", d => data += d);
process.stdin.on("end", () => {
  try {
    const obj = JSON.parse(data);
    if (!obj || !obj.id) { process.stderr.write("Missing id in create response\n"); process.exit(2); }
    process.stdout.write(String(obj.id));
  } catch (e) {
    process.stderr.write("Invalid JSON create response\n");
    process.exit(1);
  }
});
')

if [ -z "${EVENT_ID}" ]; then
  echo "Failed to extract event id" >&2
  exit 1
fi

echo "Extracted EVENT_ID=${EVENT_ID}"

echo "3) Listing events in range..."
curl -sS "${BASE_URL}/sessions/${SESSION_ID}/events?range_start=2025-01-01T00:00:00Z&range_end=2025-01-31T23:59:59Z"
echo

echo "4) Reading created event..."
curl -sS "${BASE_URL}/sessions/${SESSION_ID}/events/${EVENT_ID}"
echo

echo "5) Updating event title..."
curl -sS -X PATCH "${BASE_URL}/sessions/${SESSION_ID}/events/${EVENT_ID}" \
  -H 'Content-Type: application/json' \
  -d '{ "title": "Updated Call" }'
echo

echo "6) Deleting event..."
curl -sS -X DELETE "${BASE_URL}/sessions/${SESSION_ID}/events/${EVENT_ID}"
echo

echo "Done."

