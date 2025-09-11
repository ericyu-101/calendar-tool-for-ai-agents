FROM node:20-alpine

WORKDIR /app

# Install only production deps first for better caching
# Copy both manifest and lockfile if present
COPY package*.json ./
# Prefer npm ci when a lockfile exists for reproducible builds; fall back to install
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund --progress=false; \
    else \
      npm install --omit=dev --no-audit --no-fund --progress=false; \
    fi

# Copy source
COPY src ./src

# Environment (override in runtime as needed)
ENV NODE_ENV=production

# Default command runs the MCP server over stdio
CMD ["node", "src/server.js"]
