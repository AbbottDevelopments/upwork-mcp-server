import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../common/api-client.js';
import { UpworkMcpError } from '../common/errors.js';
import { SEARCH_JOBS, GET_JOB_DETAILS } from '../graphql/queries.js';

// --- Zod Schemas ---

const SearchJobsInput = {
  keywords: z.string().optional().describe('Search terms (Lucene syntax supported)'),
  skills: z.array(z.string()).optional().describe('Filter by skill names'),
  budget_min: z.number().optional().describe('Minimum budget amount'),
  budget_max: z.number().optional().describe('Maximum budget amount'),
  experience_level: z.enum(['entry', 'intermediate', 'expert']).optional().describe('Required experience level'),
  category: z.string().optional().describe('Job category name or ID'),
  contract_type: z.enum(['hourly', 'fixed']).optional().describe('Contract type filter'),
  sort_by: z.enum(['recency', 'relevance']).default('recency').describe('Sort order'),
  limit: z.number().min(1).max(100).default(20).describe('Results per page (1-100)'),
  cursor: z.string().optional().describe('Pagination cursor from previous results'),
  client_hires_min: z.number().optional().describe('Minimum client hires (post-filter — may reduce results below limit)'),
  client_feedback_min: z.number().optional().describe('Minimum client feedback score (post-filter)'),
  payment_verified: z.boolean().optional().describe('Require payment-verified client (post-filter)'),
  proposal_count_max: z.number().optional().describe('Maximum proposals on job (post-filter)'),
  hours_posted_max: z.number().optional().describe('Maximum hours since posting (post-filter)'),
};

const GetJobDetailsInput = {
  job_id: z.string().describe('Upwork job/opening ID or ciphertext'),
};

// --- GraphQL Variable Builders ---

function buildSearchVariables(input: z.infer<z.ZodObject<typeof SearchJobsInput>>) {
  const filter: Record<string, unknown> = {};

  if (input.keywords) filter.q = input.keywords;
  if (input.skills?.length) filter.attrs = { skills: input.skills };
  if (input.budget_min !== undefined || input.budget_max !== undefined) {
    filter.amount = {
      ...(input.budget_min !== undefined && { min: input.budget_min }),
      ...(input.budget_max !== undefined && { max: input.budget_max }),
    };
  }
  if (input.experience_level) {
    const tierMap = { entry: 'ENTRY', intermediate: 'INTERMEDIATE', expert: 'EXPERT' };
    filter.contractorTier = tierMap[input.experience_level];
  }
  if (input.category) {
    filter.occupations = { groups: [input.category] };
  }
  if (input.contract_type) {
    filter.type = input.contract_type === 'hourly' ? 'HOURLY' : 'FIXED';
  }

  const sortAttributes = input.sort_by === 'relevance'
    ? [{ field: 'RELEVANCE', sortOrder: 'DESC' }]
    : [{ field: 'RECENCY', sortOrder: 'DESC' }];

  const pagination: Record<string, unknown> = { first: input.limit };
  if (input.cursor) pagination.after = input.cursor;

  return { filter, sortAttributes, pagination };
}

// --- Post-Filters ---

interface JobNode {
  client?: {
    totalHires?: number;
    totalFeedback?: number;
    verificationStatus?: string;
  };
  proposalsTotalCount?: number;
  publishedDateTime?: string;
  [key: string]: unknown;
}

function applyPostFilters(jobs: JobNode[], input: z.infer<z.ZodObject<typeof SearchJobsInput>>): JobNode[] {
  let filtered = jobs;

  if (input.client_hires_min !== undefined) {
    filtered = filtered.filter((j) => (j.client?.totalHires ?? 0) >= input.client_hires_min!);
  }
  if (input.client_feedback_min !== undefined) {
    filtered = filtered.filter((j) => (j.client?.totalFeedback ?? 0) >= input.client_feedback_min!);
  }
  if (input.payment_verified !== undefined) {
    filtered = filtered.filter((j) => {
      const verified = j.client?.verificationStatus === 'VERIFIED';
      return input.payment_verified ? verified : !verified;
    });
  }
  if (input.proposal_count_max !== undefined) {
    filtered = filtered.filter((j) => (j.proposalsTotalCount ?? 0) <= input.proposal_count_max!);
  }
  if (input.hours_posted_max !== undefined) {
    const cutoff = Date.now() - input.hours_posted_max! * 3600_000;
    filtered = filtered.filter((j) => {
      if (!j.publishedDateTime) return true;
      return new Date(j.publishedDateTime).getTime() >= cutoff;
    });
  }

  return filtered;
}

// --- Tool Registration ---

export function register(server: McpServer, apiClient: ApiClient): void {
  server.tool(
    'search_jobs',
    'Search Upwork jobs using server-side GraphQL filters. Some filters (client_hires_min, client_feedback_min, payment_verified, proposal_count_max, hours_posted_max) are post-filters that may reduce results below the requested limit.',
    SearchJobsInput,
    async (input) => {
      try {
        const variables = buildSearchVariables(input);
        const data = await apiClient.graphql<{
          marketplaceJobPostings: {
            totalCount: number;
            pageInfo: { endCursor: string; hasNextPage: boolean };
            edges: Array<{ node: JobNode }>;
          };
        }>(SEARCH_JOBS, variables);

        if (!data.marketplaceJobPostings) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'No results returned from Upwork API' }) }], isError: true };
        }

        let jobs = data.marketplaceJobPostings.edges.map((e) => e.node);
        const hasPostFilters = input.client_hires_min !== undefined
          || input.client_feedback_min !== undefined
          || input.payment_verified !== undefined
          || input.proposal_count_max !== undefined
          || input.hours_posted_max !== undefined;

        if (hasPostFilters) {
          jobs = applyPostFilters(jobs, input);
        }

        const result = {
          total_count: data.marketplaceJobPostings.totalCount,
          result_count: jobs.length,
          next_cursor: data.marketplaceJobPostings.pageInfo.hasNextPage
            ? data.marketplaceJobPostings.pageInfo.endCursor
            : null,
          post_filtered: hasPostFilters,
          jobs,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );

  server.tool(
    'get_job_details',
    'Get complete job posting details with embedded client intelligence (hires, spend, feedback, verification status).',
    GetJobDetailsInput,
    async (input) => {
      try {
        const data = await apiClient.graphql<{
          marketplaceJobPosting: Record<string, unknown>;
        }>(GET_JOB_DETAILS, { id: input.job_id });

        if (!data.marketplaceJobPosting) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Job not found' }) }], isError: true };
        }

        return { content: [{ type: 'text', text: JSON.stringify(data.marketplaceJobPosting) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );
}
