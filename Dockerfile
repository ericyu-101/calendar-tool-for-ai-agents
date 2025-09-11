FROM node:20-alpine

WORKDIR /app

# Make npm networking more robust in CI/builders
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry "$NPM_REGISTRY" \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-factor 2 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fund false \
  && npm config set audit false

# Install only production deps first for better caching
# Copy both manifest and lockfile if present
COPY package*.json ./
# Prefer npm ci when a lockfile exists for reproducible builds; fall back to install
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund --no-optional --progress=false; \
    else \
      npm install --omit=dev --no-audit --no-fund --no-optional --progress=false; \
    fi

# Copy source
COPY src ./src

# Environment (override in runtime as needed)
ENV NODE_ENV=production

# Default command runs the MCP server over stdio
CMD ["node", "src/server.js"]
