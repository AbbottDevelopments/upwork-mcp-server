import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../common/api-client.js';
import { UpworkMcpError } from '../common/errors.js';
import { GET_EARNINGS_REPORT } from '../graphql/queries.js';

const GetEarningsReportInput = {
  period: z.enum(['this_week', 'last_week', 'this_month', 'last_month', 'custom']).default('this_month').describe('Time period for report'),
  start_date: z.string().date().optional().describe('Start date YYYY-MM-DD (required if period=custom)'),
  end_date: z.string().date().optional().describe('End date YYYY-MM-DD (required if period=custom)'),
  contract_id: z.string().optional().describe('Filter to specific contract'),
};

/** Format a UTC date as YYYY-MM-DD */
function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function computeDateRange(period: string, startDate?: string, endDate?: string): { start: string; end: string } | null {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const today = formatDate(y, m, d);

  switch (period) {
    case 'this_week': {
      const dayOfWeek = now.getUTCDay();
      const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(Date.UTC(y, m, d - offset));
      return { start: formatDate(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()), end: today };
    }
    case 'last_week': {
      const dayOfWeek = now.getUTCDay();
      const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const lastMonday = new Date(Date.UTC(y, m, d - offset - 7));
      const lastSunday = new Date(Date.UTC(y, m, d - offset - 1));
      return {
        start: formatDate(lastMonday.getUTCFullYear(), lastMonday.getUTCMonth(), lastMonday.getUTCDate()),
        end: formatDate(lastSunday.getUTCFullYear(), lastSunday.getUTCMonth(), lastSunday.getUTCDate()),
      };
    }
    case 'this_month': {
      return { start: formatDate(y, m, 1), end: today };
    }
    case 'last_month': {
      const lastMonthDate = new Date(Date.UTC(y, m, 0)); // Last day of previous month
      const lmY = lastMonthDate.getUTCFullYear();
      const lmM = lastMonthDate.getUTCMonth();
      return {
        start: formatDate(lmY, lmM, 1),
        end: formatDate(lmY, lmM, lastMonthDate.getUTCDate()),
      };
    }
    case 'custom': {
      if (!startDate || !endDate) return null;
      return { start: startDate, end: endDate };
    }
    default:
      return { start: today, end: today };
  }
}

export function register(server: McpServer, apiClient: ApiClient): void {
  server.tool(
    'get_earnings_report',
    'Get earnings and time reports for financial tracking. Supports predefined periods (this_week, last_week, this_month, last_month) or custom date ranges. Optionally filter by contract.',
    GetEarningsReportInput,
    async (input) => {
      try {
        const range = computeDateRange(input.period, input.start_date, input.end_date);
        if (!range) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_INPUT', message: 'start_date and end_date are required when period is custom' }) }],
            isError: true,
          };
        }

        const { start, end } = range;
        const filter: Record<string, unknown> = {
          dateRange: { start, end },
        };
        if (input.contract_id) {
          filter.contractId = input.contract_id;
        }

        const data = await apiClient.graphql<{
          freelancerTimeReport: {
            totalCharges?: { rawValue?: string | number; currency?: string };
            totalHours?: number;
            entries?: Array<Record<string, unknown>>;
          } | null;
        }>(GET_EARNINGS_REPORT, { filter });

        if (!data.freelancerTimeReport) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              period: input.period,
              date_range: { start, end },
              total_charges: { rawValue: '0', currency: 'USD' },
              total_hours: 0,
              entries: [],
            }) }],
          };
        }

        const report = data.freelancerTimeReport;
        const result = {
          period: input.period,
          date_range: { start, end },
          total_charges: report.totalCharges ?? { rawValue: '0', currency: 'USD' },
          total_hours: report.totalHours ?? 0,
          entries: report.entries ?? [],
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );
}
