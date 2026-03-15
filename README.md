# Upwork MCP Server

An open-source [Model Context Protocol](https://modelcontextprotocol.io/) server that connects AI agents to the Upwork API — enabling agentic job discovery, client intelligence, and freelancer workflow automation.

## Why This Exists

Freelancers spend hours browsing job boards, evaluating fit, and writing proposals. AI agents are great at this kind of work — filtering, summarizing, drafting — but they need a standardized way to access the data.

This MCP server gives any MCP-compatible AI client (Claude Desktop, custom agents, etc.) direct access to Upwork's API through a clean, tool-based interface.

## Features

- **OAuth 2.0 authentication** — Secure token-based auth with automatic refresh and persistent storage
- **GraphQL API client** — Typed queries and mutations against Upwork's GraphQL endpoint
- **Rate limiting** — Built-in request throttling to stay within Upwork API limits
- **Error handling** — Structured error types with actionable messages
- **MCP standard** — Works with any MCP-compatible client out of the box

## Quick Start

### Prerequisites

- Node.js 18+
- Upwork API credentials ([developer portal](https://www.upwork.com/developer/keys/apply))

### Setup

```bash
# Clone and install
git clone https://github.com/AbbottDevelopments/upwork-mcp-server.git
cd upwork-mcp-server
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your UPWORK_CLIENT_ID and UPWORK_CLIENT_SECRET

# Build
npm run build

# Authenticate (one-time OAuth flow)
npm run auth

# Run the server
npm start
```

### Connect to Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "upwork": {
      "command": "node",
      "args": ["/path/to/upwork-mcp-server/dist/index.js"],
      "env": {
        "UPWORK_CLIENT_ID": "your-client-id",
        "UPWORK_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### Connect to Claude Code

```bash
claude mcp add upwork -- node /path/to/upwork-mcp-server/dist/index.js
```

## Project Structure

```
src/
  index.ts              # MCP server entry point
  auth/
    oauth.ts            # OAuth 2.0 authorization flow
    token-store.ts      # Persistent token storage (~/.upwork-mcp/)
  common/
    api-client.ts       # Upwork API client with auth + rate limiting
    errors.ts           # Structured error types
    rate-limiter.ts     # Request throttling
    poll-store.ts       # Polling state management
    types.ts            # TypeScript type definitions
  graphql/
    queries.ts          # Read operations (jobs, profiles, contracts)
    mutations.ts        # Write operations (proposals, messages)
  operations/           # High-level MCP tool implementations
```

## Development

```bash
# Watch mode (rebuilds on change)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Status

**Phase 1 complete** — OAuth flow, API client, rate limiting, and project scaffold are built and tested. MCP tool implementations (job search, proposal drafting, etc.) are in active development.

## Contributing

Issues and PRs welcome. If you're a freelancer who wants specific Upwork workflows exposed as MCP tools, open an issue describing your use case.

## License

MIT — see [LICENSE](LICENSE) for details.

## Author

Built by [Abbott Developments](https://abotdevelopments.dev) — AI automation and process consulting for operations-heavy businesses.
