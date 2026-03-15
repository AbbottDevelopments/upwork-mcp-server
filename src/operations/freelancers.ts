import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../common/api-client.js';
import { UpworkMcpError } from '../common/errors.js';

const SearchFreelancersInput = {
  query: z.string().optional().describe('Search terms'),
  skills: z.array(z.string()).optional().describe('Filter by skill names'),
  hourly_rate_min: z.number().min(0).optional().describe('Minimum hourly rate'),
  hourly_rate_max: z.number().min(0).optional().describe('Maximum hourly rate'),
  job_success_min: z.number().min(0).max(100).optional().describe('Minimum Job Success Score (0-100)'),
  earned_amount_min: z.number().min(0).optional().describe('Minimum total earnings'),
  country: z.string().optional().describe('Country filter'),
  english_level: z.enum(['any', 'conversational', 'fluent', 'native']).optional().describe('English proficiency level'),
  offset: z.number().min(0).default(0).describe('Pagination offset (0-based)'),
  limit: z.number().min(1).max(50).default(20).describe('Results per page (1-50)'),
};

function buildSearchParams(input: z.infer<z.ZodObject<typeof SearchFreelancersInput>>): URLSearchParams {
  const params = new URLSearchParams();
  if (input.query) params.set('q', input.query);
  if (input.skills?.length) params.set('skills', input.skills.join(';'));
  if (input.hourly_rate_min !== undefined) params.set('rate_from', String(input.hourly_rate_min));
  if (input.hourly_rate_max !== undefined) params.set('rate_to', String(input.hourly_rate_max));
  if (input.job_success_min !== undefined) params.set('fb_score_from', String(input.job_success_min));
  if (input.earned_amount_min !== undefined) params.set('earnings_from', String(input.earned_amount_min));
  if (input.country) params.set('loc', input.country);
  if (input.english_level && input.english_level !== 'any') {
    const levelMap = { conversational: '2', fluent: '3', native: '4' };
    params.set('english_level', levelMap[input.english_level]);
  }
  params.set('paging', `${input.offset};${input.limit}`);
  return params;
}

export function register(server: McpServer, apiClient: ApiClient): void {
  server.tool(
    'get_my_profile',
    'Get your freelancer profile including title, overview, skills, hourly rate, availability, earnings, JSS, and profile completeness.',
    {},
    async () => {
      try {
        const profile = await apiClient.rest<Record<string, unknown>>('/profiles/v1/contractors/me');
        return { content: [{ type: 'text', text: JSON.stringify(profile) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );

  server.tool(
    'get_connects_balance',
    'Check your available Upwork connects balance before applying to jobs.',
    {},
    async () => {
      try {
        const connects = await apiClient.rest<Record<string, unknown>>('/profiles/v1/contractors/me/connects');
        return { content: [{ type: 'text', text: JSON.stringify(connects) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );

  server.tool(
    'search_freelancers',
    'Search freelancer profiles for competitive research. Filter by skills, rate, JSS, earnings, country, and English level.',
    SearchFreelancersInput,
    async (input) => {
      try {
        if (input.hourly_rate_min !== undefined && input.hourly_rate_max !== undefined && input.hourly_rate_min > input.hourly_rate_max) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: 'hourly_rate_min cannot exceed hourly_rate_max' }) }],
            isError: true,
          };
        }
        const params = buildSearchParams(input);
        const data = await apiClient.rest<Record<string, unknown>>(
          `/profiles/v1/search/providers?${params.toString()}`
        );
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );
}
