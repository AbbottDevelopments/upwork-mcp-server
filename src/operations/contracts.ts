import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../common/api-client.js';
import { UpworkMcpError } from '../common/errors.js';
import { LIST_CONTRACTS, GET_CONTRACT_DETAILS } from '../graphql/queries.js';
import { CREATE_MILESTONE, EDIT_MILESTONE, REQUEST_MILESTONE_APPROVAL } from '../graphql/mutations.js';

const ListContractsInput = {
  status: z.enum(['active', 'ended', 'cancelled', 'all']).default('active').describe('Filter by contract status'),
  contract_type: z.enum(['hourly', 'fixed', 'all']).default('all').describe('Filter by contract type'),
  limit: z.number().min(1).max(100).default(20).describe('Results per page (1-100)'),
  cursor: z.string().optional().describe('Pagination cursor from previous results'),
};

const GetContractDetailsInput = {
  contract_id: z.string().describe('Contract ID'),
};

const ManageMilestonesInput = {
  action: z.enum(['create', 'edit', 'request_approval']).describe('Action to perform on milestone'),
  contract_id: z.string().describe('Contract ID'),
  milestone_id: z.string().optional().describe('Milestone ID (required for edit/request_approval)'),
  description: z.string().optional().describe('Milestone description (required for create/edit)'),
  amount: z.number().positive().optional().describe('Milestone amount (required for create/edit)'),
  due_date: z.string().date().optional().describe('Due date in YYYY-MM-DD format'),
};

export function register(server: McpServer, apiClient: ApiClient): void {
  server.tool(
    'list_contracts',
    'List your contracts filtered by status and type. Supports pagination.',
    ListContractsInput,
    async (input) => {
      try {
        const filter: Record<string, unknown> = {};
        if (input.status !== 'all') {
          filter.status = input.status.toUpperCase();
        }
        if (input.contract_type !== 'all') {
          filter.contractType = input.contract_type.toUpperCase();
        }

        const pagination: Record<string, unknown> = { first: input.limit };
        if (input.cursor) pagination.after = input.cursor;

        const data = await apiClient.graphql<{
          vendorContracts: {
            totalCount: number;
            pageInfo: { endCursor: string; hasNextPage: boolean };
            edges: Array<{ node: Record<string, unknown> }>;
          } | null;
        }>(LIST_CONTRACTS, { filter, pagination });

        if (!data.vendorContracts) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'No contracts data returned' }) }], isError: true };
        }

        const result = {
          total_count: data.vendorContracts.totalCount,
          result_count: data.vendorContracts.edges.length,
          next_cursor: data.vendorContracts.pageInfo.hasNextPage
            ? data.vendorContracts.pageInfo.endCursor
            : null,
          contracts: data.vendorContracts.edges.map((e) => e.node),
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );

  server.tool(
    'get_contract_details',
    'Get full contract details including milestones, time logged, total earned, and client info.',
    GetContractDetailsInput,
    async (input) => {
      try {
        const data = await apiClient.graphql<{
          vendorContract: Record<string, unknown> | null;
        }>(GET_CONTRACT_DETAILS, { id: input.contract_id });

        if (!data.vendorContract) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Contract not found' }) }], isError: true };
        }

        return { content: [{ type: 'text', text: JSON.stringify(data.vendorContract) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );

  server.tool(
    'manage_milestones',
    'Manage milestones on fixed-price contracts. Actions: create (propose new milestone), edit (modify pending milestone), request_approval (request payment for completed milestone). Scoped to freelancer role.',
    ManageMilestonesInput,
    async (input) => {
      try {
        // Validate required fields per action
        if (input.action === 'create') {
          if (!input.description || input.amount === undefined) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: 'description and amount are required for create action' }) }],
              isError: true,
            };
          }
        }
        if (input.action === 'edit') {
          if (!input.milestone_id) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: 'milestone_id is required for edit action' }) }],
              isError: true,
            };
          }
          if (!input.description && input.amount === undefined) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: 'at least description or amount is required for edit action' }) }],
              isError: true,
            };
          }
        }
        if (input.action === 'request_approval') {
          if (!input.milestone_id) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: 'milestone_id is required for request_approval action' }) }],
              isError: true,
            };
          }
        }

        let result: Record<string, unknown>;

        switch (input.action) {
          case 'create': {
            const data = await apiClient.graphql<{ createMilestoneV2: Record<string, unknown> }>(
              CREATE_MILESTONE,
              {
                input: {
                  contractId: input.contract_id,
                  description: input.description,
                  amount: input.amount,
                  ...(input.due_date !== undefined && { dueDate: input.due_date }),
                },
              }
            );
            result = data.createMilestoneV2;
            break;
          }
          case 'edit': {
            const data = await apiClient.graphql<{ editMilestone: Record<string, unknown> }>(
              EDIT_MILESTONE,
              {
                input: {
                  milestoneId: input.milestone_id,
                  ...(input.description !== undefined && { description: input.description }),
                  ...(input.amount !== undefined && { amount: input.amount }),
                  ...(input.due_date !== undefined && { dueDate: input.due_date }),
                },
              }
            );
            result = data.editMilestone;
            break;
          }
          case 'request_approval': {
            const data = await apiClient.graphql<{ requestMilestoneApproval: Record<string, unknown> }>(
              REQUEST_MILESTONE_APPROVAL,
              {
                input: {
                  milestoneId: input.milestone_id,
                },
              }
            );
            result = data.requestMilestoneApproval;
            break;
          }
          default: {
            const _exhaustive: never = input.action;
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: `Unknown action: ${_exhaustive}` }) }],
              isError: true,
            };
          }
        }

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );
}
