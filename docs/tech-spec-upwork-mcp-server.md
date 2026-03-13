---
title: 'Upwork MCP Server'
slug: 'upwork-mcp-server'
created: '2026-03-12'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Node.js 18+', 'TypeScript', '@modelcontextprotocol/sdk v1.27.1', 'zod@3', 'node-upwork-oauth2', 'Upwork GraphQL API', 'OAuth 2.0', 'Vitest']
files_to_modify: []
code_patterns: ['McpServer + StdioServerTransport', 'Zod schemas for tool inputs', 'operations/ directory for tool grouping', 'ES modules (type: module)', 'Node16 module resolution']
test_patterns: ['Vitest', 'MCP Inspector for interactive testing', '__tests__/ directory']
---

# Tech-Spec: Upwork MCP Server

**Created:** 2026-03-12

## Overview

### Problem Statement

No quality MCP server exists for Upwork. The one existing package (`@chinchillaenterprises/mcp-upwork`) is unmaintained (7 months stale, GitHub repo 404'd), locked to AWS Secrets Manager auth, has no real OAuth flow, no token refresh, and does client-side keyword filtering instead of using Upwork's server-side GraphQL filters. AI agents like Claude cannot effectively interact with the Upwork platform — freelancers must manually search jobs, analyze clients, draft proposals, check messages, and track contracts.

### Solution

Build an open-source Node.js/TypeScript MCP server that wraps Upwork's GraphQL API (with REST fallbacks where needed), providing 15 agentic-first tools designed around the freelancer workflow: discover opportunities → score quality → draft proposals → manage work. Distributed via npm with a localhost OAuth 2.0 auth flow and proper token refresh.

### Scope

**In Scope:**
- Job search with 15+ server-side GraphQL filters (skills, budget, client history, payment verified, experience level, proposal count, location/timezone)
- Job detail retrieval with embedded client intelligence
- Composite opportunity scoring tool (client quality + budget fit + competition + skill match)
- Freelancer profile search (competitive research)
- Profile read + availability updates
- Proposal tracking with status/outcomes
- Connects balance checking
- Read/send messages (rooms, threads)
- Active contracts & milestones management (full CRUD)
- Earnings & time reports
- Notification polling (new jobs, messages, proposal updates)
- Localhost OAuth 2.0 authentication flow with real token refresh
- README + setup guide
- npm/npx distribution (`npx upwork-mcp-server`)
- MIT license, open source from day one

**Out of Scope:**
- Automated proposal submission (Upwork API restriction — scope `pub-submit-proposal:write:all` exists but mutation is not active)
- Deployed auth proxy (future if community demand)
- Webhook receiver server (Upwork has no webhook/subscription support)
- UI/dashboard
- Commercial SaaS features
- Profile title/description/skills/rate/photo updates (not supported by API)
- Saved/favorited jobs (no API support)

## Context for Development

### Architecture

```
upwork-mcp-server/
  src/
    index.ts              # Server init, tool registration, transport
    auth/
      oauth.ts            # OAuth 2.0 localhost flow + token refresh
      token-store.ts      # Token persistence (~/.upwork-mcp/token.json)
    operations/
      jobs.ts             # search_jobs, get_job_details, score_opportunity
      proposals.ts        # track_proposals, get_connects_balance
      clients.ts          # analyze_client
      freelancers.ts      # get_my_profile, search_freelancers
      contracts.ts        # list_contracts, get_contract_details, manage_milestones
      earnings.ts         # get_earnings_report
      messages.ts         # list_messages, send_message, poll_notifications
    graphql/
      queries.ts          # All GraphQL query definitions
      mutations.ts        # All GraphQL mutation definitions
    common/
      api-client.ts       # HTTP client with auth headers, rate limiting, retry
      rate-limiter.ts     # 10 req/sec, 300/min, 40K/day enforcement — per-HTTP-request counting
      types.ts            # Shared TypeScript types
      errors.ts           # Structured error types (AUTH_REQUIRED, TOKEN_EXPIRED, etc.)
      poll-store.ts       # Snapshot persistence for poll_notifications (~/.upwork-mcp/poll-state.json)
  __tests__/
    auth.test.ts
    jobs.test.ts
    clients.test.ts
    contracts.test.ts
    messages.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  LICENSE
  .env.example
```

- **Standalone repository:** `AbbottDevelopments/upwork-mcp-server`
- **Runtime:** Node.js 18+ / TypeScript
- **MCP SDK:** `@modelcontextprotocol/sdk` v1.27.1
- **Schema Validation:** `zod@3`
- **Upwork Auth SDK:** `node-upwork-oauth2` (official Upwork package) — **Fallback:** If this package does not support localhost redirect URIs or programmatic token refresh, implement OAuth 2.0 Authorization Code Grant manually using raw HTTP requests (standard spec, well-documented). The localhost HTTP server for callback is custom either way.
- **API Target:** Upwork GraphQL API (`https://api.upwork.com/graphql`) with REST fallbacks for freelancer search, profile, and connects
- **Auth:** OAuth 2.0 Authorization Code Grant with localhost callback
- **Token Storage:** `~/.upwork-mcp/token.json` (access token TTL: 24h, refresh token TTL: 2 weeks). File created with mode 0600 (owner read/write only). Directory `~/.upwork-mcp/` created with mode 0700. README must warn users to add `**/token.json` to global `.gitignore`. On Windows, use `fs.chmod` equivalent or document manual permissions.
- **Distribution:** npm package with `bin` field, runnable via `npx`
- **Transport:** StdioServerTransport (standard for Claude Desktop/CLI)

### Auth Flow Design

1. User runs `npx upwork-mcp-server auth`
2. Temporary local HTTP server starts on port 9876 (chosen to avoid common dev server conflicts; configurable via `--port` flag)
3. Browser opens to Upwork authorization URL
4. User approves → Upwork redirects to `http://localhost:9876/callback`
5. Auth code exchanged for access + refresh tokens
6. Tokens saved to `~/.upwork-mcp/token.json` with file permissions 0600
7. Local HTTP server shuts down automatically
8. Subsequent MCP tool calls use stored token
9. On 401 → auto-refresh using refresh token → retry original request
10. If refresh fails (>2 weeks expired) → return MCP error with message: "Refresh token expired. Run `npx upwork-mcp-server auth` to re-authorize."

**Port constraint:** The redirect URI registered with Upwork's API app MUST match the runtime port. The README must instruct users to register `http://localhost:9876/callback` as their redirect URI. If they change the port via `--port`, they must update their Upwork app registration to match.

### Codebase Patterns

- **Tool Registration:** `McpServer.registerTool()` with Zod input schemas
- **Tool Handlers:** Return `{ content: [{ type: "text", text: JSON.stringify(result) }] }` — clean structured JSON, no emoji formatting
- **Operations Pattern:** Each file in `operations/` exports tool registration functions grouped by domain
- **API Client:** Centralized HTTP client handles auth headers, token refresh, rate limiting, and retry with exponential backoff
- **Rate Limiting:** Token bucket algorithm — 10 req/sec burst, 300/min sustained, 40K/day cap. Rate limiter counts per-HTTP-request (not per-tool-call). Composite tools like `score_opportunity` (2 calls) and `poll_notifications` (2-3 calls) consume multiple tokens. The rate limiter is shared across all tools via the centralized API client.
- **Error Handling:** Structured error responses via MCP `isError: true` with JSON body:
  ```json
  { "error": "TOKEN_EXPIRED", "message": "Refresh token expired. Run `npx upwork-mcp-server auth` to re-authorize.", "retryable": false }
  ```
  Error categories:
  - `AUTH_REQUIRED` — No token found (retryable: false, action: run auth)
  - `TOKEN_EXPIRED` — Refresh failed (retryable: false, action: run auth)
  - `RATE_LIMITED` — 429 received (retryable: true, auto-retry with backoff)
  - `API_ERROR` — Upwork returned non-200 (retryable: depends on status code)
  - `NETWORK_ERROR` — Connection timeout/failure (retryable: true, 3 attempts)
  - `INVALID_INPUT` — Zod validation failed (retryable: false, action: fix input)
  - `PARTIAL_RESPONSE` — GraphQL returned data with errors (return partial data + warnings)
- **No `console.log()`:** Stdio transport — all debug output via `console.error()` or SDK logging
- **Shebang:** Entry point starts with `#!/usr/bin/env node`

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `@chinchillaenterprises/mcp-upwork` | Competitor reference — validated GraphQL queries, known working field selections |
| `@modelcontextprotocol/server-github` | Architecture reference — operations/ pattern, tool registration, env var auth |
| `@modelcontextprotocol/server-filesystem` | Reference — tool annotations (readOnlyHint, destructiveHint) |
| `node-upwork-oauth2` | Official Upwork OAuth SDK — use for token exchange and refresh |
| Upwork GraphQL Explorer | `https://www.upwork.com/developer/explorer/` — test queries interactively |

### Technical Decisions

| Decision | Rationale |
| ---- | ------- |
| Node.js over Python | TypeScript MCP SDK is more mature, npm/npx is the community standard distribution, larger MCP ecosystem |
| GraphQL-first with REST fallbacks | GraphQL is Upwork's supported path forward; REST needed for freelancer search, profile, connects (not yet in GraphQL) |
| Localhost OAuth over hosted proxy | Zero infrastructure, tokens on user's machine, no commercial use flags, OSS standard |
| All 15 tools in v1, phased delivery | Complete feature set differentiates from competitor. But phases are independently shippable: Phase 1+2 (auth + 6 core tools) is a usable MVP. Phase 3+4 add depth. If Phase 3 or 4 is blocked, ship Phase 1+2 as v0.1.0. |
| Structured JSON output over formatted text | Agentic consumption — agents parse structured data, not emoji-formatted strings |
| `score_opportunity` as composite tool | Killer differentiator — no other Upwork MCP server provides intelligent job scoring |
| MIT license | Maximum community adoption, matches MCP ecosystem convention |
| `node-upwork-oauth2` with manual fallback | Official SDK preferred if it supports localhost redirect + refresh. If not, implement OAuth 2.0 Auth Code Grant via raw HTTP — it's a standard spec (RFC 6749). Phase 1, Task 3 must verify SDK capabilities before committing. |

### Competitor Analysis

**`@chinchillaenterprises/mcp-upwork` v2.8.0** — the only existing Upwork MCP server:
- 14 tools, ~75% GraphQL coverage
- **Dead:** Last update Aug 2025, GitHub repo 404'd, 290 downloads/month
- **AWS-locked:** Requires AWS Secrets Manager — no env var or local auth option
- **No real OAuth flow:** Cannot do initial authorization or token refresh
- **Client-side filtering:** Fetches all jobs then filters in memory instead of using GraphQL filters
- **No client intelligence tools, no opportunity scoring, no earnings reports, no milestone management**
- **Emoji-heavy output:** Not designed for agentic consumption

Our differentiators: real OAuth flow, proper token refresh, server-side filtering, client scoring, agentic-first structured output, active maintenance, comprehensive docs.

## Tool Specifications

### Tier 1: Core Agentic Loop (Job Discovery → Proposal)

#### 1. `search_jobs`
**Description:** Search Upwork jobs using the `marketplaceJobPostings` GraphQL query
**API:** GraphQL — `marketplaceJobPostings` query with `MarketplaceJobFilter` input type
**Inputs (confirmed via schema introspection):**
- `keywords` (string, optional) — Search terms mapped to `q` filter (Lucene syntax supported)
- `skills` (string[], optional) — Mapped to `attrs.skills` filter
- `budget_min` / `budget_max` (number, optional) — Mapped to `amount.min/max` filter
- `experience_level` (enum: entry/intermediate/expert, optional) — Mapped to `contractorTier`
- `category` (string, optional) — Mapped to `occupations.groups` or `occupations.oservice`
- `contract_type` (enum: hourly/fixed, optional) — Mapped to `hourlyBudgetType` / `type`
- `sort_by` (enum: recency/relevance, default: recency) — Mapped to `sortAttributes`
- `limit` (number, 1-100, default: 20) — Mapped to `pagination.first`
- `cursor` (string, optional) — Cursor-based pagination via `pagination.after`

**Inputs (require runtime verification against live schema — may need client-side fallback):**
- `client_hires_min` (number, optional) — Check if `client.totalHires` is a filter param or only a response field
- `client_feedback_min` (number, optional) — Check if `client.totalFeedback` is a filter param or only a response field
- `payment_verified` (boolean, optional) — Check if `client.verificationStatus` is a filter param or only a response field
- `proposal_count_max` (number, optional) — Likely response-field only; implement as client-side post-filter
- `hours_posted_max` (number, optional) — Check if `postedDateTime` supports range filtering or use `daysSincePosted` if available

**Implementation note:** During Phase 2, Task 6, the implementer MUST run test queries against the GraphQL Explorer to confirm which filters are server-side vs response-only. Any filters that are response-field-only should be implemented as client-side post-filters and documented as such. The tool description shown to agents should clearly indicate which filters are server-side (fast) vs post-filters (may reduce result count below limit).

**Returns:** Array of job summaries with title, budget, skills, client snapshot, proposal count, posted date
**Annotations:** `readOnlyHint: true`

#### 2. `get_job_details`
**Description:** Get complete job posting with embedded client intelligence
**Inputs:**
- `job_id` (string, required) — Upwork job/opening ID
**Returns:** Full posting details + client data (total hires, total spend, feedback score, verification status, member since, total posted jobs, total reviews) + job activity (invites sent, total hired, unanswered invites)
**Annotations:** `readOnlyHint: true`

#### 3. `score_opportunity`
**Description:** Composite quality scoring for a job opportunity. Internally calls `get_job_details` (1 API call) and optionally `get_my_profile` (1 API call if `my_skills` not provided). All scoring is computed locally from the returned data — no additional API calls.
**Inputs:**
- `job_id` (string, required) — Job to score
- `my_skills` (string[], optional) — Your skills for match scoring (if omitted, fetches from profile — costs 1 extra API call)
- `my_hourly_rate` (number, optional) — Your rate for budget fit scoring (if omitted, fetches from profile)
**Returns:** Composite score (0-100) with breakdown:
- `client_quality` (0-25): weighted sum of client signals
- `budget_fit` (0-25): budget alignment score
- `competition` (0-25): inverse competition pressure
- `skill_match` (0-25): skills overlap percentage
- `flags`: array of red/yellow/green signals with labels
**Annotations:** `readOnlyHint: true`

**Scoring Algorithm:**

**`client_quality` (0-25):**
| Signal | Points | Logic |
|--------|--------|-------|
| Payment verified | 5 | verified=5, unverified=0 |
| Hire history | 5 | 0 hires=0, 1-3=2, 4-10=4, 10+=5 |
| Total spend | 5 | <$100=0, $100-1K=2, $1K-10K=4, $10K+=5 |
| Feedback score | 5 | score × 1.0 (e.g., 4.5 → 4.5, capped at 5) |
| Account tenure | 5 | <6mo=1, 6mo-2yr=3, 2yr+=5 |

Red flags: `unverified payment` (0 points), `0 hires` (0 points), `feedback < 3.0`
Green flags: `verified + 10K+ spent + 4.5+ feedback`

**`budget_fit` (0-25):**
| Scenario | Points | Logic |
|----------|--------|-------|
| Hourly job, rate provided | 25 | Linear scale: if job max rate >= your rate → 25. If job max rate < your rate → `25 × (job_max / your_rate)`. If no rate range on job → 15 (neutral). |
| Fixed-price job, rate provided | 25 | Estimate hours = budget / your_rate. If hours >= 10 → 25 (substantial). 5-10 → 20. < 5 → 10 (may not be worth it). |
| No rate provided | 15 | Neutral score — cannot assess fit |

Red flags: `budget < 50% of your rate equivalent`
Yellow flags: `no budget specified`

**`competition` (0-25):**
| Signal | Points | Logic |
|--------|--------|-------|
| Proposal count | 15 | 0-4=15, 5-9=12, 10-19=8, 20-49=4, 50+=0 |
| Days posted | 5 | <1 day=5, 1-3=4, 3-7=3, 7-14=2, 14+=1 |
| Invites sent | 5 | 0=5 (client hasn't pre-picked), 1-3=3, 4+=1 |

Green flags: `< 5 proposals`, `posted < 24h ago`
Red flags: `50+ proposals`, `posted 14+ days ago with 0 hires`

**`skill_match` (0-25):**
| Logic | Points |
|-------|--------|
| Jaccard similarity: `intersection(my_skills, job_skills) / union(my_skills, job_skills)` | `similarity × 25` |
| If job has no listed skills | 15 (neutral) |
| If user provides no skills and profile fetch fails | 12 (neutral) |

Green flags: `90%+ match`
Yellow flags: `< 30% match`

#### 4. `get_my_profile`
**Description:** Get your freelancer profile for proposal context
**Inputs:** None (uses authenticated user)
**Returns:** Profile data — title, overview, skills, hourly rate, availability, earnings, JSS, profile completeness
**Annotations:** `readOnlyHint: true`
**API:** REST (`/profiles/v1/contractors/me`)

#### 5. `track_proposals`
**Description:** List your proposals with status and outcomes
**API:** GraphQL — `vendorProposals` query
**Inputs:**
- `status` (enum: active/archived/all, optional, default: active)
- `limit` (number, 1-50, default: 20)
- `cursor` (string, optional) — Pagination cursor for next page
**Returns:** Array of proposals with job title, cover letter preview, charge rate, status, timestamps, client response. Includes `next_cursor` for pagination.
**Annotations:** `readOnlyHint: true`

#### 6. `get_connects_balance`
**Description:** Check your available connects before applying
**Inputs:** None
**Returns:** Available connects count, connects usage history
**Annotations:** `readOnlyHint: true`
**API:** REST (`/profiles/v1/contractors/me/connects`)

### Tier 2: Client Intelligence

#### 7. `analyze_client`
**Description:** Deep analysis of a client extracted from a job posting. Upwork does not expose a standalone client profile endpoint — client data is embedded in job posting responses via the `client` field in the `marketplaceJobPosting` GraphQL query. This tool calls `get_job_details` internally (1 API call) and extracts/scores the client data.
**Inputs:**
- `job_id` (string, required) — Job posting to extract client data from. This is the only access path because Upwork embeds client data in job responses, not as a standalone resource.
**Returns:** Client profile aggregate:
- Hire statistics (total hires, active contracts, hire rate)
- Financial signals (total spend, avg hourly rate paid, payment verification)
- Reputation (feedback score, total reviews)
- Activity (total jobs posted, member since, country)
- Risk assessment using same scoring weights as `score_opportunity.client_quality` (red/yellow/green flags with explanations)
**Annotations:** `readOnlyHint: true`
**Design note:** If a user wants to analyze a client from a contract context (not a job posting), they should use `get_contract_details` to find the associated job ID first. A future version could accept `contract_id` as an alternative input if the contract GraphQL response also embeds client data — verify during implementation.

#### 8. `search_freelancers`
**Description:** Research competitor freelancers in your market
**Inputs:**
- `query` (string, optional) — Search terms
- `skills` (string[], optional) — Skill filters
- `hourly_rate_min` / `hourly_rate_max` (number, optional)
- `job_success_min` (number, optional) — Minimum JSS
- `earned_amount_min` (number, optional)
- `country` (string, optional)
- `english_level` (enum: any/conversational/fluent/native, optional)
- `limit` (number, 1-50, default: 20)
**Returns:** Freelancer summaries with title, rate, JSS, earnings, skills, availability
**Annotations:** `readOnlyHint: true`
**API:** REST (`/profiles/v1/search/providers`)

### Tier 3: Active Work Management

#### 9. `list_contracts`
**Description:** List your contracts filtered by status
**API:** GraphQL — `vendorContracts` query
**Inputs:**
- `status` (enum: active/ended/cancelled/all, optional, default: active)
- `contract_type` (enum: hourly/fixed/all, optional, default: all)
- `limit` (number, 1-100, default: 20)
- `cursor` (string, optional) — Pagination cursor for next page
**Returns:** Contract summaries with title, client, status, rate/budget, start date, earnings. Includes `next_cursor` for pagination.
**Annotations:** `readOnlyHint: true`

#### 10. `get_contract_details`
**Description:** Full contract details including milestones
**API:** GraphQL — `vendorContract` query by ID
**Inputs:**
- `contract_id` (string, required)
**Returns:** Complete contract — title, description, client info, rate, milestones (status, amount, due date), time logged, total earned
**Annotations:** `readOnlyHint: true`

#### 11. `manage_milestones`
**Description:** Manage milestones on fixed-price contracts. **Scoped to freelancer role** — actions are limited to what a freelancer can do. Client-only actions (fund milestone, approve payment) are not included.
**Inputs:**
- `action` (enum: create/edit/request_approval, required)
  - `create` — Propose a new milestone (freelancer can propose; client must approve/fund)
  - `edit` — Edit a pending milestone description/amount (only before client funds it)
  - `request_approval` — Request client approval/payment for a completed milestone
- `contract_id` (string, required)
- `milestone_id` (string, required for edit/request_approval)
- `description` (string, required for create/edit)
- `amount` (number, required for create/edit)
- `due_date` (string, optional) — ISO date
**Returns:** Updated milestone details with status
**Annotations:** `readOnlyHint: false`, `destructiveHint: false`
**Implementation note:** The GraphQL mutations `createMilestoneV2` and `editMilestone` are confirmed in the schema. Verify which mutations are available to the freelancer role specifically — if `request_approval` has no corresponding mutation, implement as `send_message` to the contract room with a formatted approval request instead.

#### 12. `get_earnings_report`
**Description:** Earnings and time reports for financial tracking
**API:** GraphQL — `clientTimeReport` or `freelancerTimeReport` query (verify which is available to freelancer role during implementation)
**Inputs:**
- `period` (enum: this_week/last_week/this_month/last_month/custom, default: this_month)
- `start_date` / `end_date` (string, optional — required if period=custom)
- `contract_id` (string, optional) — Filter to specific contract
**Returns:** Earnings summary — total earned, hours logged, by-contract breakdown, daily totals
**Annotations:** `readOnlyHint: true`

### Tier 4: Communication

#### 13. `list_messages`
**Description:** List message rooms with activity status
**API:** GraphQL — `roomList` query
**Inputs:**
- `unread_only` (boolean, default: false)
- `limit` (number, 1-50, default: 20)
- `cursor` (string, optional) — Pagination cursor for next page
**Returns:** Rooms with last message preview, unread count, participants, contract association. Includes `next_cursor` for pagination.
**Annotations:** `readOnlyHint: true`

#### 14. `send_message`
**Description:** Send a message in an existing room
**API:** REST — `POST /messages/v3/{company}/rooms/{room_id}/stories`. The `{company}` path parameter is the authenticated user's organization/company ID, obtained from the `/profiles/v1/contractors/me` response (field: `company_id` or `org_uid`). This value should be fetched once during auth/startup and cached.
**Inputs:**
- `room_id` (string, required)
- `message` (string, required)
**Returns:** Sent message confirmation with timestamp
**Annotations:** `readOnlyHint: false`, `destructiveHint: false`

#### 15. `poll_notifications`
**Description:** Check for new activity by diffing current state against previous poll. This is a composite tool — no dedicated Upwork notifications endpoint exists. It works by calling other tools and comparing results to a locally cached snapshot.
**Mechanism:**
1. On first call: fetches current state and saves snapshot to `~/.upwork-mcp/poll-state.json`
2. On subsequent calls: fetches current state, diffs against snapshot, returns changes, updates snapshot
**Internal API calls per poll (budget: 3-4 calls):**
- `list_messages` with `unread_only: true` → new/unread messages (1 GraphQL call)
- `track_proposals` with `status: active` → proposal status changes (1 GraphQL call)
- `search_jobs` with user's saved filter (optional) → new jobs since last poll (1 GraphQL call)
**Inputs:**
- `include_jobs` (boolean, default: false) — Also poll for new jobs matching saved filter (costs 1 extra API call)
- `job_filter` (object, optional) — Filter params for job polling (same schema as `search_jobs`). Required if `include_jobs: true`.
**Returns:** Activity diff:
- `new_messages`: array of rooms with new unread messages since last poll
- `proposal_updates`: array of proposals with status changes since last poll
- `new_jobs`: array of new job postings matching filter (only if `include_jobs: true`)
- `poll_timestamp`: ISO timestamp of this poll
- `previous_poll_timestamp`: ISO timestamp of last poll (null on first call)
**Annotations:** `readOnlyHint: true`
**Note:** Rate limit impact is 2-3 API calls per poll. At 15-min intervals, this is ~12 calls/hour — well within limits.

## Implementation Plan

### Tasks

**Shippable milestones:** Phase 1+2 = v0.1.0 MVP (auth + 6 core agentic tools). Phase 3 = v0.2.0. Phase 4 = v1.0.0. Each phase is independently shippable if later phases are blocked.

#### Phase 1: Project Scaffold & Auth (Component A)
1. Initialize npm project with TypeScript, ESM config, bin field, shebang
2. Set up `@modelcontextprotocol/sdk` with `McpServer` + `StdioServerTransport`
3. Implement OAuth 2.0 localhost flow using `node-upwork-oauth2`
4. Implement token storage (`~/.upwork-mcp/token.json`) with auto-refresh on 401
5. Build centralized API client with auth headers, rate limiter (token bucket), retry with exponential backoff

#### Phase 2: Core Agentic Tools (Component B)
6. Implement `search_jobs` with full GraphQL filter set
7. Implement `get_job_details` with client intelligence extraction
8. Implement `score_opportunity` composite scoring algorithm
9. Implement `get_my_profile` (REST) and `get_connects_balance` (REST)
10. Implement `track_proposals` with status filtering

#### Phase 3: Intelligence & Work Management (Component C)
11. Implement `analyze_client` deep client analysis
12. Implement `search_freelancers` (REST)
13. Implement `list_contracts`, `get_contract_details`, `manage_milestones`
14. Implement `get_earnings_report` with time period filtering

#### Phase 4: Communication & Polish (Component D)
15. Implement `list_messages`, `send_message` (REST), `poll_notifications`
16. Write unit tests for all tools (Vitest)
17. Write README with setup guide, Claude Desktop config examples, tool documentation
18. Publish to npm, verify `npx` distribution works

### Acceptance Criteria

**Auth Flow:**
- Given a user with Upwork API credentials, when they run `npx upwork-mcp-server auth`, then a browser opens, they authorize, and tokens are saved locally
- Given an expired access token, when any tool is called, then the token is auto-refreshed using the refresh token without user intervention
- Given an expired refresh token (>2 weeks), when any tool is called, then a clear error message prompts re-authorization

**Job Discovery:**
- Given search parameters, when `search_jobs` is called, then results are filtered server-side via GraphQL (not client-side)
- Given a job ID, when `get_job_details` is called, then client intelligence data (hires, spend, feedback, verification) is included
- Given a job ID, when `score_opportunity` is called, then a 0-100 composite score with category breakdown and flags is returned

**Work Management:**
- Given an active contract, when `manage_milestones` is called with action=create, then a new milestone is created on Upwork
- Given a time period, when `get_earnings_report` is called, then accurate earnings with per-contract breakdown are returned

**Communication:**
- Given a room ID and message, when `send_message` is called, then the message appears in the Upwork conversation
- Given a time window, when `poll_notifications` is called, then new activity across all categories is returned

**Rate Limiting:**
- Given rapid successive API calls, when rate limits are approached, then requests are queued/delayed (not dropped)
- Given a 429 response, when retry logic activates, then exponential backoff is applied and the request eventually succeeds

**Distribution:**
- Given the published npm package, when a user runs `npx upwork-mcp-server`, then the MCP server starts and connects via stdio
- Given a fresh install, when the user follows the README setup guide, then they can have Claude searching Upwork jobs within 5 minutes (excluding API key approval wait)

**Error Handling (Negative Cases):**
- Given no stored token, when any tool is called, then an `AUTH_REQUIRED` error with setup instructions is returned (not a crash)
- Given an invalid/malformed job ID, when `get_job_details` is called, then an `API_ERROR` with "Job not found" is returned
- Given the Upwork API is unreachable, when any tool is called, then a `NETWORK_ERROR` is returned after 3 retry attempts with exponential backoff
- Given a 429 rate limit response, when the rate limiter handles it, then the request is retried with backoff and eventually succeeds or returns `RATE_LIMITED` after max retries
- Given invalid Zod input (e.g., `limit: -5`), when any tool is called, then `INVALID_INPUT` error with field-level details is returned before any API call is made

## Additional Context

### Dependencies

| Package | Purpose | Version |
| ------- | ------- | ------- |
| `@modelcontextprotocol/sdk` | MCP server framework | ^1.27.1 |
| `zod` | Schema validation for tool inputs | ^3.25 |
| `node-upwork-oauth2` | Official Upwork OAuth 2.0 SDK | latest |
| `vitest` | Testing framework | latest (devDep) |
| `typescript` | Language | ^5.x (devDep) |

### Testing Strategy

- **Unit tests** (Vitest): Test each tool handler with mocked API responses — validate input schemas, output structure, error handling
- **Integration tests**: Use MCP Inspector (`npx @modelcontextprotocol/inspector`) for interactive tool testing against live API
- **Auth tests**: Test token storage, refresh flow, and expiry handling
- **Rate limiter tests**: Verify token bucket behavior under load
- **No CI/CD against live API** — Upwork has no sandbox; all live API testing is manual during development

### API Rate Limits

| Limit | Value |
| ----- | ----- |
| Per-second burst | 10 requests |
| Per-minute sustained | 300 requests |
| Daily cap | 40,000 requests |
| 429 handling | Exponential backoff with jitter |

### Prerequisites

- **Upwork API key required** — Apply at https://www.upwork.com/developer/keys/apply (~2 week approval)
- **Verified Upwork identity** required for API access
- **Node.js 18+** required

### Portfolio/Case Study Value

1. **Personal tooling:** Daily Upwork workflow automation for job discovery and proposal optimization
2. **Portfolio piece:** Demonstrates MCP expertise, API integration, OAuth flows, open-source stewardship
3. **Community first-mover:** Only quality Upwork MCP server — existing competitor is unmaintained and AWS-locked
4. **Case study angle:** "Built an AI-powered Upwork assistant using MCP" — showcases exactly the kind of work being sold on the platform
5. **Open source visibility:** npm distribution, GitHub discoverability, potential for community contributions

### Notes

- No Upwork sandbox environment — all API calls hit production during development
- Auto-proposal submission scope exists (`pub-submit-proposal:write:all`) but mutation is not yet active — monitor for future API updates
- GraphQL endpoint: `https://api.upwork.com/graphql`
- GraphQL Explorer for testing: `https://www.upwork.com/developer/explorer/`
- Access tokens expire in 24 hours; refresh tokens expire after 2 weeks of non-use
- REST endpoints still needed for: freelancer search, profile, connects, messaging (send)
