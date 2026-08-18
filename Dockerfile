# Paperjet remote MCP server (Streamable HTTP).
# Build:  docker build -t paperjet-mcp .
# Run:    docker run -p 3000:3000 paperjet-mcp
FROM oven/bun:1-debian

# LibreOffice Writer powers the docx_to_pdf tool; drop these two lines for a
# ~600 MB smaller image without that tool (the server detects its absence).
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-writer fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/mcp-http.ts"]
