# Paperjet remote MCP server (Streamable HTTP).
# Build:  docker build -t paperjet-mcp .
# Run:    docker run -p 3000:3000 paperjet-mcp
#
# Every tool, Word → PDF included, is pure TypeScript — no LibreOffice or
# other system packages are needed.
FROM oven/bun:1-debian

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/mcp-http.ts"]
