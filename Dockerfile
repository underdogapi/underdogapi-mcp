# Runs the stdio MCP server. Nothing to install: it uses only Node built-ins.
FROM node:22-alpine
WORKDIR /app
COPY package.json LICENSE ./
COPY bin ./bin
USER node
ENTRYPOINT ["node", "bin/underdog-api-mcp.mjs"]
