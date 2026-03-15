import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../common/api-client.js';
import { UpworkMcpError } from '../common/errors.js';
import { LIST_PROPOSALS } from '../graphql/queries.js';

const TrackProposalsInput = {
  status: z.enum(['active', 'archived', 'all']).default('active').describe('Filter by proposal status'),
  limit: z.number().min(1).max(50).default(20).describe('Results per page (1-50)'),
  cursor: z.string().optional().describe('Pagination cursor from previous results'),
};

export function register(server: McpServer, apiClient: ApiClient): void {
  server.tool(
    'track_proposals',
    'List your proposals with status, outcomes, cover letter preview, charge rate, and client response. Supports pagination.',
    TrackProposalsInput,
    async (input) => {
      try {
        const filter: Record<string, unknown> = {};
        if (input.status !== 'all') {
          filter.status = input.status.toUpperCase();
        }

        const pagination: Record<string, unknown> = { first: input.limit };
        if (input.cursor) pagination.after = input.cursor;

        const data = await apiClient.graphql<{
          vendorProposals: {
            totalCount: number;
            pageInfo: { endCursor: string; hasNextPage: boolean };
            edges: Array<{ node: Record<string, unknown> }>;
          };
        }>(LIST_PROPOSALS, { filter, pagination });

        const result = {
          total_count: data.vendorProposals.totalCount,
          result_count: data.vendorProposals.edges.length,
          next_cursor: data.vendorProposals.pageInfo.hasNextPage
            ? data.vendorProposals.pageInfo.endCursor
            : null,
          proposals: data.vendorProposals.edges.map((e) => e.node),
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );
}
