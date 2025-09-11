FROM node:20-alpine

WORKDIR /app

# Install only production deps first for better caching
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY src ./src

# Environment (override in runtime as needed)
ENV NODE_ENV=production

# Default command runs the MCP server over stdio
CMD ["node", "src/server.js"]
