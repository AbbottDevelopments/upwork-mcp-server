# Upwork MCP Server

An open-source [Model Context Protocol](https://modelcontextprotocol.io/) server that connects AI agents to the Upwork API — enabling agentic job discovery, client intelligence, and freelancer workflow automation.

## Why This Exists

Freelancers spend hours browsing job boards, evaluating fit, and writing proposals. AI agents are great at this kind of work — filtering, summarizing, drafting — but they need a standardized way to access the data.

This MCP server gives any MCP-compatible AI client (Claude Desktop, custom agents, etc.) direct access to Upwork's API through a clean, tool-based interface.

## Features

- **15 agentic tools** covering the full freelancer workflow: discover → score → propose → manage → communicate
- **OAuth 2.0 authentication** — Secure localhost callback flow with automatic token refresh
- **Composite scoring** — `score_opportunity` rates jobs 0-100 across client quality, budget fit, competition, and skill match
- **GraphQL + REST** — Uses Upwork's GraphQL API with REST fallbacks where needed
- **Rate limiting** — Token bucket (10/sec, 300/min, 40K/day) with exponential backoff
- **Structured errors** — Typed error categories with retryability flags and actionable messages
- **Poll notifications** — Stateful diffing for new messages, proposal updates, and job matches

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

## Tools

| Tool | Description |
|------|-------------|
| `search_jobs` | Search Upwork jobs with 15+ server-side filters |
| `get_job_details` | Full job posting with embedded client intelligence |
| `score_opportunity` | Composite 0-100 quality scoring with red/yellow/green flags |
| `analyze_client` | Deep client risk assessment from a job posting |
| `get_my_profile` | Your freelancer profile, skills, rate, and JSS |
| `get_connects_balance` | Available connects before applying |
| `search_freelancers` | Competitor research by skills, rate, JSS, country |
| `track_proposals` | List proposals with status and outcomes |
| `list_contracts` | Active/ended contracts with filtering |
| `get_contract_details` | Full contract with milestones and earnings |
| `manage_milestones` | Create, edit, or request approval on milestones |
| `get_earnings_report` | Earnings and time reports by period or custom range |
| `list_messages` | Message rooms with unread counts and previews |
| `send_message` | Send a message in an existing room |
| `poll_notifications` | Check for new messages, proposal updates, and job matches |

## Architecture

See [docs/architecture.md](docs/architecture.md) for diagrams showing how the system connects — also available as an [Excalidraw file](docs/architecture.excalidraw) for interactive editing.

For implementation details, see the [technical specification](docs/tech-spec-upwork-mcp-server.md).

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

**All 15 tools implemented** — OAuth flow, API client, rate limiting, and all four phases (scaffold, core tools, work management, communication) are built and reviewed. Ready for live API testing with Upwork credentials.

## Contributing

Issues and PRs welcome. If you're a freelancer who wants specific Upwork workflows exposed as MCP tools, open an issue describing your use case.

## License

MIT — see [LICENSE](LICENSE) for details.

## Author

Built by [Abbott Developments](https://abotdevelopments.dev) — AI automation and process consulting for operations-heavy businesses.
