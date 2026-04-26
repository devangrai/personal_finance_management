export type AdvisorToolName =
  | "cashflow_summary"
  | "retirement_contribution"
  | "emergency_fund"
  | "portfolio_allocation"
  | "tax_bucket_summary";

export type AdvisorRequestContext = {
  userId: string;
  asOfDate: string;
  objective: string;
};

export type AdvisorRecommendation = {
  headline: string;
  rationale: string[];
  cautions: string[];
  followUps: string[];
};

export const advisorSystemIntent = `
Use only structured tool results and saved user profile context.
Do not fabricate account balances, contribution limits, tax facts, or investment performance.
Surface missing inputs explicitly before making a recommendation.
`;
