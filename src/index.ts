#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { UpworkConfig } from './common/types.js';
import { TokenStore } from './auth/token-store.js';
import { OAuthFlow } from './auth/oauth.js';
import { ApiClient } from './common/api-client.js';

// F17: Read version from package.json at startup
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8')) as { version: string };

function loadConfig(): UpworkConfig {
  const clientId = process.env.UPWORK_CLIENT_ID;
  const clientSecret = process.env.UPWORK_CLIENT_SECRET;
  const redirectUri = process.env.UPWORK_REDIRECT_URI ?? 'http://localhost:9876/callback';

  if (!clientId || !clientSecret) {
    console.error('Error: UPWORK_CLIENT_ID and UPWORK_CLIENT_SECRET environment variables are required.');
    console.error('See .env.example for the required format.');
    process.exit(1);
  }

  return { clientId, clientSecret, redirectUri };
}

async function runAuth(): Promise<void> {
  const config = loadConfig();
  const tokenStore = new TokenStore();
  const oauth = new OAuthFlow(config, tokenStore);

  console.error('Starting Upwork OAuth 2.0 authorization flow...');
  try {
    await oauth.authorize();
    console.error('\nAuthorization successful! Tokens saved to ~/.upwork-mcp/token.json');
    console.error('You can now use the MCP server with Claude Desktop or other MCP clients.');
  } catch (err) {
    console.error('\nAuthorization failed:', (err as Error).message);
    process.exit(1);
  }
}

async function runServer(): Promise<void> {
  const config = loadConfig();
  const tokenStore = new TokenStore();
  const apiClient = new ApiClient(config, tokenStore);

  const server = new McpServer({
    name: 'upwork-mcp-server',
    version: pkg.version,
  });

  // Tool registrations will be added in Phase 2+
  // Each operations/ file will export a register function that takes (server, apiClient)

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Upwork MCP server running on stdio transport');
}

// CLI entry point
const command = process.argv[2];

if (command === 'auth') {
  runAuth().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
} else {
  runServer().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
