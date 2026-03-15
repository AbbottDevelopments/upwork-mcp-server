import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../common/api-client.js';
import { UpworkMcpError } from '../common/errors.js';
import { GET_JOB_DETAILS } from '../graphql/queries.js';

// --- Types ---

interface MoneyValue {
  rawValue?: string | number;
  currency?: string;
}

interface ClientData {
  totalHires?: number;
  activeContractCount?: number;
  totalPostedJobs?: number;
  totalSpent?: MoneyValue;
  totalFeedback?: number;
  verificationStatus?: string;
  companyName?: string;
  location?: { city?: string; country?: string };
  memberSince?: string;
  totalReviews?: number;
  avgHourlyRate?: MoneyValue;
}

interface JobData {
  id?: string;
  title?: string;
  client?: ClientData;
  content?: { skills?: Array<{ prettyName?: string }> };
  proposalsTotalCount?: number;
  invitesTotalCount?: number;
  publishedDateTime?: string;
  job?: {
    contractTerms?: {
      contractType?: string;
      amount?: MoneyValue;
      hourlyBudgetType?: string;
      fixedBudgetMin?: MoneyValue;
      fixedBudgetMax?: MoneyValue;
    };
  };
  hourlyBudgetMin?: MoneyValue;
  hourlyBudgetMax?: MoneyValue;
  weeklyBudget?: MoneyValue;
  [key: string]: unknown;
}

// --- Scoring Helpers ---

function toNumber(val: string | number | undefined): number {
  if (val === undefined) return 0;
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(num) ? 0 : num;
}

type FlagColor = 'red' | 'yellow' | 'green';
interface Flag {
  color: FlagColor;
  label: string;
}

function scoreClientQuality(client: ClientData | undefined): { score: number; flags: Flag[] } {
  if (!client) return { score: 0, flags: [{ color: 'red', label: 'No client data available' }] };

  const flags: Flag[] = [];
  let score = 0;

  // Payment verified (0-5)
  const verified = client.verificationStatus === 'VERIFIED';
  score += verified ? 5 : 0;
  if (!verified) flags.push({ color: 'red', label: 'Unverified payment' });

  // Hire history (0-5)
  const hires = client.totalHires ?? 0;
  if (hires === 0) { score += 0; flags.push({ color: 'red', label: '0 hires' }); }
  else if (hires <= 3) score += 2;
  else if (hires <= 10) score += 4;
  else score += 5;

  // Total spend (0-5)
  const spent = toNumber(client.totalSpent?.rawValue);
  if (spent < 100) score += 0;
  else if (spent < 1000) score += 2;
  else if (spent < 10000) score += 4;
  else score += 5;

  // Feedback score (0-5)
  const feedback = client.totalFeedback ?? 0;
  score += Math.min(feedback, 5);
  if (feedback < 3 && feedback > 0) flags.push({ color: 'red', label: `Low feedback: ${feedback}` });

  // Account tenure (0-5)
  if (client.memberSince) {
    const tenureMs = Date.now() - new Date(client.memberSince).getTime();
    const tenureMonths = tenureMs / (30 * 24 * 3600_000);
    if (tenureMonths < 6) score += 1;
    else if (tenureMonths < 24) score += 3;
    else score += 5;
  }

  // Green flag combo
  if (verified && spent >= 10000 && feedback >= 4.5) {
    flags.push({ color: 'green', label: 'Verified + $10K+ spent + 4.5+ feedback' });
  }

  return { score: Math.min(score, 25), flags };
}

function scoreBudgetFit(job: JobData, myRate?: number): { score: number; flags: Flag[] } {
  const flags: Flag[] = [];

  if (myRate === undefined) return { score: 15, flags: [{ color: 'yellow', label: 'No rate provided — neutral score' }] };

  const contractType = job.job?.contractTerms?.contractType;
  const isHourly = contractType === 'HOURLY' || contractType === 'hourly';

  if (isHourly) {
    const maxRate = toNumber(job.hourlyBudgetMax?.rawValue);
    if (maxRate === 0) return { score: 15, flags: [{ color: 'yellow', label: 'No budget specified' }] };

    const ratio = maxRate / myRate;
    if (ratio < 0.5) flags.push({ color: 'red', label: `Budget < 50% of your rate ($${maxRate}/hr vs $${myRate}/hr)` });
    return { score: Math.round(Math.min(ratio, 1) * 25), flags };
  }

  // Fixed-price
  const budget = toNumber(job.job?.contractTerms?.amount?.rawValue)
    || toNumber(job.job?.contractTerms?.fixedBudgetMax?.rawValue);
  if (budget === 0) return { score: 15, flags: [{ color: 'yellow', label: 'No budget specified' }] };

  const estimatedHours = budget / myRate;
  if (estimatedHours >= 10) return { score: 25, flags };
  if (estimatedHours >= 5) return { score: 20, flags };
  if (budget < myRate * 5 * 0.5) flags.push({ color: 'red', label: `Budget < 50% of rate equivalent` });
  return { score: 10, flags };
}

function scoreCompetition(job: JobData): { score: number; flags: Flag[] } {
  const flags: Flag[] = [];
  let score = 0;

  // Proposal count (0-15)
  const proposals = job.proposalsTotalCount ?? 0;
  if (proposals < 5) { score += 15; flags.push({ color: 'green', label: `< 5 proposals (${proposals})` }); }
  else if (proposals < 10) score += 12;
  else if (proposals < 20) score += 8;
  else if (proposals < 50) score += 4;
  else { score += 0; flags.push({ color: 'red', label: `50+ proposals (${proposals})` }); }

  // Days posted (0-5)
  if (job.publishedDateTime) {
    const daysPosted = (Date.now() - new Date(job.publishedDateTime).getTime()) / (24 * 3600_000);
    if (daysPosted < 1) { score += 5; flags.push({ color: 'green', label: 'Posted < 24h ago' }); }
    else if (daysPosted < 3) score += 4;
    else if (daysPosted < 7) score += 3;
    else if (daysPosted < 14) score += 2;
    else {
      score += 1;
      flags.push({ color: 'red', label: 'Posted 14+ days ago with 0 hires' });
    }
  }

  // Invites sent (0-5)
  const invites = job.invitesTotalCount ?? 0;
  if (invites === 0) score += 5;
  else if (invites <= 3) score += 3;
  else score += 1;

  return { score: Math.min(score, 25), flags };
}

function scoreSkillMatch(jobSkills: string[], mySkills: string[]): { score: number; flags: Flag[] } {
  const flags: Flag[] = [];

  if (jobSkills.length === 0) return { score: 15, flags: [{ color: 'yellow', label: 'No skills listed on job' }] };
  if (mySkills.length === 0) return { score: 12, flags: [{ color: 'yellow', label: 'No skills provided' }] };

  const jobSet = new Set(jobSkills.map((s) => s.toLowerCase()));
  const mySet = new Set(mySkills.map((s) => s.toLowerCase()));

  const intersection = new Set([...jobSet].filter((s) => mySet.has(s)));
  // Use job coverage ratio: what % of job's required skills do I have?
  const similarity = intersection.size / jobSet.size;

  const score = Math.round(similarity * 25);

  if (similarity >= 0.9) flags.push({ color: 'green', label: `${Math.round(similarity * 100)}% skill match` });
  if (similarity < 0.3) flags.push({ color: 'yellow', label: `Low skill match: ${Math.round(similarity * 100)}%` });

  return { score, flags };
}

// --- Tool Registration ---

const ScoreOpportunityInput = {
  job_id: z.string().describe('Job ID to score'),
  my_skills: z.array(z.string()).optional().describe('Your skills for match scoring (if omitted, fetches from profile)'),
  my_hourly_rate: z.number().positive().optional().describe('Your hourly rate for budget fit scoring (if omitted, fetches from profile)'),
};

export function register(server: McpServer, apiClient: ApiClient): void {
  server.tool(
    'score_opportunity',
    'Composite quality scoring (0-100) for a job opportunity. Analyzes client quality, budget fit, competition level, and skill match. Internally calls get_job_details (1 API call) and optionally get_my_profile (1 API call if my_skills not provided).',
    ScoreOpportunityInput,
    async (input) => {
      try {
        // Fetch job details (1 API call)
        const jobData = await apiClient.graphql<{
          marketplaceJobPosting: JobData;
        }>(GET_JOB_DETAILS, { id: input.job_id });
        const job = jobData.marketplaceJobPosting;
        if (!job) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Job not found' }) }], isError: true };
        }

        // Resolve skills and rate
        let mySkills = input.my_skills ?? [];
        let myRate = input.my_hourly_rate;

        if (mySkills.length === 0 || myRate === undefined) {
          try {
            const profile = await apiClient.rest<{
              skills?: Array<{ skill?: string }>;
              rate?: number;
              profile?: { hourly_rate?: number };
            }>('/profiles/v1/contractors/me');
            if (mySkills.length === 0 && profile.skills) {
              mySkills = profile.skills.map((s) => s.skill ?? '').filter(Boolean);
            }
            if (myRate === undefined) {
              myRate = profile.rate ?? profile.profile?.hourly_rate;
            }
          } catch {
            // Profile fetch failed — use neutral scores
            console.error('[upwork-mcp] Could not fetch profile for scoring — using neutral scores');
          }
        }

        const jobSkills = job.content?.skills?.map((s) => s.prettyName ?? '') ?? [];

        // Compute scores
        const clientQ = scoreClientQuality(job.client);
        const budgetF = scoreBudgetFit(job, myRate);
        const compet = scoreCompetition(job);
        const skillM = scoreSkillMatch(jobSkills, mySkills);

        const totalScore = clientQ.score + budgetF.score + compet.score + skillM.score;
        const allFlags = [...clientQ.flags, ...budgetF.flags, ...compet.flags, ...skillM.flags];

        const result = {
          score: totalScore,
          breakdown: {
            client_quality: { score: clientQ.score, max: 25 },
            budget_fit: { score: budgetF.score, max: 25 },
            competition: { score: compet.score, max: 25 },
            skill_match: { score: skillM.score, max: 25 },
          },
          flags: allFlags,
          job_title: job.title,
          job_id: job.id,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );

  server.tool(
    'analyze_client',
    'Deep analysis of a client extracted from a job posting. Returns hire statistics, financial signals, reputation, activity, and risk assessment with red/yellow/green flags.',
    { job_id: z.string().describe('Job posting ID to extract client data from') },
    async (input) => {
      try {
        const jobData = await apiClient.graphql<{
          marketplaceJobPosting: JobData;
        }>(GET_JOB_DETAILS, { id: input.job_id });
        const job = jobData.marketplaceJobPosting;
        if (!job) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Job not found' }) }], isError: true };
        }
        const client = job.client;

        if (!client) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'No client data found for this job posting' }) }],
            isError: true,
          };
        }

        const qualityScore = scoreClientQuality(client);
        const spent = toNumber(client.totalSpent?.rawValue);

        const result = {
          company_name: client.companyName,
          location: client.location,
          member_since: client.memberSince,
          hire_statistics: {
            total_hires: client.totalHires ?? 0,
            active_contracts: client.activeContractCount ?? 0,
            total_posted_jobs: client.totalPostedJobs ?? 0,
            hire_rate: client.totalPostedJobs
              ? Math.round(((client.totalHires ?? 0) / client.totalPostedJobs) * 100)
              : 0,
          },
          financial_signals: {
            total_spend: spent,
            avg_hourly_rate: toNumber(client.avgHourlyRate?.rawValue),
            payment_verified: client.verificationStatus === 'VERIFIED',
          },
          reputation: {
            feedback_score: client.totalFeedback ?? 0,
            total_reviews: client.totalReviews ?? 0,
          },
          risk_assessment: {
            quality_score: qualityScore.score,
            max_score: 25,
            flags: qualityScore.flags,
          },
        };

        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        if (err instanceof UpworkMcpError) return err.toMcpError();
        throw err;
      }
    }
  );
}
