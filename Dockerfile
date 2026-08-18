# Paperjet remote MCP server (Streamable HTTP).
# Build:  docker build -t paperjet-mcp .
# Slim (no LibreOffice, no docx_to_pdf tool, ~600 MB smaller, much faster):
#         docker build --build-arg WITH_LIBREOFFICE=false -t paperjet-mcp .
# Run:    docker run -p 3000:3000 paperjet-mcp
FROM oven/bun:1-debian

# LibreOffice Writer powers the docx_to_pdf tool; the server detects its
# absence and simply doesn't register that tool.
ARG WITH_LIBREOFFICE=true
RUN if [ "$WITH_LIBREOFFICE" = "true" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends libreoffice-writer fonts-dejavu-core \
      && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/mcp-http.ts"]
