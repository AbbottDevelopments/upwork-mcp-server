import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../common/api-client.js';
import { UpworkMcpError } from '../common/errors.js';
import { PollStore } from '../common/poll-store.js';
import { LIST_ROOMS, LIST_PROPOSALS, SEARCH_JOBS } from '../graphql/queries.js';

// --- Types ---

interface PollSnapshot {
  timestamp: string;
  unread_counts: Record<string, number>; // room_id -> unread count
  proposal_statuses: Record<string, string>; // proposal_id -> status
  last_job_ids: string[];
}

// --- Zod Schemas ---

const ListMessagesInput = {
  unread_only: z.boolean().default(false).describe('Only show rooms with unread messages'),
  limit: z.number().min(1).max(50).default(20).describe('Results per page (1-50)'),
  cursor: z.string().optional().describe('Pagination cursor from previous results'),
};

const SendMessageInput = {
  room_id: z.string().describe('Message room ID'),
  message: z.string().min(1).max(10000).describe('Message text to send (max 10,000 chars)'),
};

const PollNotificationsInput = {
  include_jobs: z.boolean().default(false).describe('Also poll for new jobs matching filter (costs 1 extra API call)'),
  job_filter: z.object({
    keywords: z.string().optional(),
    skills: z.array(z.string()).optional(),
    budget_min: z.number().optional(),
    budget_max: z.number().optional(),
    experience_level: z.enum(['entry', 'intermediate', 'expert']).optional(),
    category: z.string().optional(),
    contract_type: z.enum(['hourly', 'fixed']).optional(),
    limit: z.number().min(1).max(50).default(10),
  }).optional().describe('Job filter params (same as search_jobs). Required if include_jobs is true.'),
};

// --- Tool Registration ---

export function register(server: McpServer, apiClient: ApiClient): void {
  const pollStore = new PollStore();
  let cachedCompanyId: string | null = null;

  server.tool(
    'list_messages',
    'List message rooms with last message preview, unread count, participants, and contract association. Supports pagination.',
    ListMessagesInput,
    async (input) => {
      try {
        const filter: Record<string, unknown> = {};
        if (input.unread_only) {
          filter.unreadOnly = true;
        }

        const pagination: Record<string, unknown> = { first: input.limit };
        if (input.cursor) pagination.after = input.cursor;

        const data = await apiClient.graphql<{
          roomList: {
            totalCount: number;
            pageInfo: { endCursor: string; hasNextPage: boolean };
            edges: Array<{ node: Record<string, unknown> }>;
          } | null;
        }>(LIST_ROOMS, { filter, pagination });

        if (!data.roomList) {
          return { content: [{ type: 'text', text: JSON.stringify({ total_count: 0, result_count: 0, next_cursor: null, rooms: [] }) }] };
        }

        const result = {
          total_count: data.roomList.totalCount,
          result_count: data.roomList.edges.length,
          next_cursor: data.roomList.pageInfo.hasNextPage
            ? data.roomList.pageInfo.endCursor
            : null,
          rooms: data.roomList.edges.map((e) => e.node),
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );

  server.tool(
    'send_message',
    'Send a message in an existing Upwork message room. Requires room_id from list_messages.',
    SendMessageInput,
    async (input) => {
      try {
        // Cache company ID across calls
        if (!cachedCompanyId) {
          const profile = await apiClient.rest<{
            company_id?: string;
            org_uid?: string;
          }>('/profiles/v1/contractors/me');

          cachedCompanyId = profile.company_id ?? profile.org_uid ?? null;
          if (!cachedCompanyId) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'API_ERROR', message: 'Could not determine company/org ID from profile' }) }],
              isError: true,
            };
          }
        }

        const data = await apiClient.rest<Record<string, unknown>>(
          `/messages/v3/${cachedCompanyId}/rooms/${input.room_id}/stories`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: input.message }),
          }
        );

        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) {
          // Clear cache on auth errors so next call re-fetches
          if (err.category === 'AUTH_REQUIRED' || err.category === 'TOKEN_EXPIRED') {
            cachedCompanyId = null;
          }
          return err.toMcpError();
        }
        throw err;
      }
    }
  );

  server.tool(
    'poll_notifications',
    'Check for new activity by diffing current state against previous poll. Returns new/unread messages, proposal status changes, and optionally new jobs matching a filter. First call establishes baseline; subsequent calls return diffs. Costs 2-3 API calls per poll.',
    PollNotificationsInput,
    async (input) => {
      try {
        // Validate job_filter required when include_jobs is true
        if (input.include_jobs && !input.job_filter) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: 'job_filter is required when include_jobs is true' }) }],
            isError: true,
          };
        }

        const previousSnapshot = await pollStore.load<PollSnapshot>();
        const now = new Date().toISOString();
        let fetchFailures = 0;

        // 1. Fetch unread messages (1 API call)
        const unreadCounts: Record<string, number> = {};
        try {
          const msgData = await apiClient.graphql<{
            roomList: {
              edges: Array<{ node: { id: string; unreadCount?: number } }>;
            } | null;
          }>(LIST_ROOMS, { filter: { unreadOnly: true }, pagination: { first: 50 } });

          if (msgData.roomList) {
            for (const edge of msgData.roomList.edges) {
              unreadCounts[edge.node.id] = edge.node.unreadCount ?? 0;
            }
          }
        } catch {
          fetchFailures++;
          console.error('[upwork-mcp] Failed to fetch messages for poll');
        }

        // 2. Fetch active proposals (1 API call)
        const proposalStatuses: Record<string, string> = {};
        try {
          const propData = await apiClient.graphql<{
            vendorProposals: {
              edges: Array<{ node: { id: string; status: string } }>;
            } | null;
          }>(LIST_PROPOSALS, { filter: {}, pagination: { first: 50 } });

          if (propData.vendorProposals) {
            for (const edge of propData.vendorProposals.edges) {
              proposalStatuses[edge.node.id] = edge.node.status;
            }
          }
        } catch {
          fetchFailures++;
          console.error('[upwork-mcp] Failed to fetch proposals for poll');
        }

        // 3. Optionally fetch new jobs (1 API call)
        let lastJobIds: string[] = [];
        let newJobs: Array<Record<string, unknown>> = [];
        if (input.include_jobs && input.job_filter) {
          try {
            const filter: Record<string, unknown> = {};
            if (input.job_filter.keywords) filter.q = input.job_filter.keywords;
            if (input.job_filter.skills?.length) filter.attrs = { skills: input.job_filter.skills };
            if (input.job_filter.budget_min !== undefined || input.job_filter.budget_max !== undefined) {
              filter.amount = {
                ...(input.job_filter.budget_min !== undefined && { min: input.job_filter.budget_min }),
                ...(input.job_filter.budget_max !== undefined && { max: input.job_filter.budget_max }),
              };
            }
            if (input.job_filter.experience_level) {
              const tierMap = { entry: 'ENTRY', intermediate: 'INTERMEDIATE', expert: 'EXPERT' };
              filter.contractorTier = tierMap[input.job_filter.experience_level];
            }
            if (input.job_filter.category) {
              filter.occupations = { groups: [input.job_filter.category] };
            }
            if (input.job_filter.contract_type) {
              filter.type = input.job_filter.contract_type === 'hourly' ? 'HOURLY' : 'FIXED';
            }

            const jobData = await apiClient.graphql<{
              marketplaceJobPostings: {
                edges: Array<{ node: { id: string; [key: string]: unknown } }>;
              } | null;
            }>(SEARCH_JOBS, {
              filter,
              sortAttributes: [{ field: 'RECENCY', sortOrder: 'DESC' }],
              pagination: { first: input.job_filter.limit },
            });

            if (jobData.marketplaceJobPostings) {
              const currentJobs = jobData.marketplaceJobPostings.edges.map((e) => e.node);
              lastJobIds = currentJobs.map((j) => j.id);

              if (previousSnapshot) {
                const prevJobSet = new Set(previousSnapshot.last_job_ids);
                newJobs = currentJobs.filter((j) => !prevJobSet.has(j.id));
              }
            }
          } catch {
            fetchFailures++;
            console.error('[upwork-mcp] Failed to fetch jobs for poll');
          }
        }

        // Compute message diffs — detect new rooms AND increased unread counts
        const messageChanges: Array<{ room_id: string; change: string; unread_count: number }> = [];
        if (previousSnapshot) {
          const prevCounts = previousSnapshot.unread_counts;
          for (const [roomId, count] of Object.entries(unreadCounts)) {
            const prevCount = prevCounts[roomId];
            if (prevCount === undefined) {
              messageChanges.push({ room_id: roomId, change: 'new_unread', unread_count: count });
            } else if (count > prevCount) {
              messageChanges.push({ room_id: roomId, change: 'more_unread', unread_count: count });
            }
          }
        } else {
          for (const [roomId, count] of Object.entries(unreadCounts)) {
            if (count > 0) {
              messageChanges.push({ room_id: roomId, change: 'unread', unread_count: count });
            }
          }
        }

        // Compute proposal diffs — detect changes AND disappearances (terminal transitions)
        const proposalUpdates: Array<{ id: string; previous_status: string | null; current_status: string | null }> = [];
        if (previousSnapshot) {
          // Check current proposals for status changes
          for (const [id, status] of Object.entries(proposalStatuses)) {
            const prevStatus = previousSnapshot.proposal_statuses[id];
            if (prevStatus !== status) {
              proposalUpdates.push({ id, previous_status: prevStatus ?? null, current_status: status });
            }
          }
          // Check for proposals that disappeared (transitioned to terminal state)
          for (const [id, prevStatus] of Object.entries(previousSnapshot.proposal_statuses)) {
            if (!(id in proposalStatuses)) {
              proposalUpdates.push({ id, previous_status: prevStatus, current_status: null });
            }
          }
        }

        // Only save snapshot if at least one fetch succeeded
        const totalFetches = input.include_jobs ? 3 : 2;
        if (fetchFailures < totalFetches) {
          const currentSnapshot: PollSnapshot = {
            timestamp: now,
            unread_counts: unreadCounts,
            proposal_statuses: proposalStatuses,
            last_job_ids: lastJobIds,
          };
          await pollStore.save(currentSnapshot);
        }

        const result = {
          new_messages: messageChanges,
          proposal_updates: proposalUpdates,
          new_jobs: input.include_jobs ? newJobs : undefined,
          poll_timestamp: now,
          previous_poll_timestamp: previousSnapshot?.timestamp ?? null,
          is_first_poll: !previousSnapshot,
          fetch_errors: fetchFailures > 0 ? fetchFailures : undefined,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );
}
