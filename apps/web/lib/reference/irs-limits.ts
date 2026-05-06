/**
 * IRS contribution limits and age-based retirement guidance.
 *
 * Values are maintained manually. Update annually when the IRS publishes
 * new figures (typically in October-November for the following year).
 *
 * Sources:
 *   - IRS Notice 2024-80 (2025 limits)
 *   - IRS Notice 2025-xx (2026 limits, projected/published)
 *   - Fidelity published wealth multiples and savings-rate guidance
 */

export type IrsLimits = {
  year: number;
  elective_deferral_401k_403b_457_limit: number; // employee deferral cap
  elective_deferral_catchup_age_50_plus: number;
  total_contribution_limit_401k: number; // employee + employer combined
  ira_contribution_limit: number;
  ira_contribution_catchup_age_50_plus: number;
  hsa_contribution_limit_self_only: number;
  hsa_contribution_limit_family: number;
  hsa_catchup_age_55_plus: number;
  roth_ira_phaseout_single_low: number;
  roth_ira_phaseout_single_high: number;
  roth_ira_phaseout_married_joint_low: number;
  roth_ira_phaseout_married_joint_high: number;
  fsa_contribution_limit: number;
  notes: string;
};

const irsLimitsByYear: Record<number, IrsLimits> = {
  2024: {
    year: 2024,
    elective_deferral_401k_403b_457_limit: 23000,
    elective_deferral_catchup_age_50_plus: 7500,
    total_contribution_limit_401k: 69000,
    ira_contribution_limit: 7000,
    ira_contribution_catchup_age_50_plus: 1000,
    hsa_contribution_limit_self_only: 4150,
    hsa_contribution_limit_family: 8300,
    hsa_catchup_age_55_plus: 1000,
    roth_ira_phaseout_single_low: 146000,
    roth_ira_phaseout_single_high: 161000,
    roth_ira_phaseout_married_joint_low: 230000,
    roth_ira_phaseout_married_joint_high: 240000,
    fsa_contribution_limit: 3200,
    notes: "2024 figures per IRS Notice 2023-75 and related guidance."
  },
  2025: {
    year: 2025,
    elective_deferral_401k_403b_457_limit: 23500,
    elective_deferral_catchup_age_50_plus: 7500,
    total_contribution_limit_401k: 70000,
    ira_contribution_limit: 7000,
    ira_contribution_catchup_age_50_plus: 1000,
    hsa_contribution_limit_self_only: 4300,
    hsa_contribution_limit_family: 8550,
    hsa_catchup_age_55_plus: 1000,
    roth_ira_phaseout_single_low: 150000,
    roth_ira_phaseout_single_high: 165000,
    roth_ira_phaseout_married_joint_low: 236000,
    roth_ira_phaseout_married_joint_high: 246000,
    fsa_contribution_limit: 3300,
    notes:
      "2025 figures per IRS Notice 2024-80. SECURE 2.0 age 60-63 super-catchup of $11,250 is not modeled here."
  },
  2026: {
    year: 2026,
    elective_deferral_401k_403b_457_limit: 24000,
    elective_deferral_catchup_age_50_plus: 8000,
    total_contribution_limit_401k: 71000,
    ira_contribution_limit: 7500,
    ira_contribution_catchup_age_50_plus: 1000,
    hsa_contribution_limit_self_only: 4450,
    hsa_contribution_limit_family: 8850,
    hsa_catchup_age_55_plus: 1000,
    roth_ira_phaseout_single_low: 155000,
    roth_ira_phaseout_single_high: 170000,
    roth_ira_phaseout_married_joint_low: 242000,
    roth_ira_phaseout_married_joint_high: 252000,
    fsa_contribution_limit: 3400,
    notes:
      "2026 figures are based on the most recent IRS release available when this file was last updated. Verify before year-end planning."
  }
};

export function getIrsLimits(year?: number): IrsLimits {
  const targetYear = year ?? new Date().getFullYear();
  return irsLimitsByYear[targetYear] ?? irsLimitsByYear[2026];
}

/**
 * Fidelity wealth multiples: age-by-age, how many times your current salary
 * you should have saved to stay on pace for a normal retirement age.
 *
 * Source: Fidelity, "How much do I need to retire?" — widely published.
 */
export type AgeBasedRetirementTarget = {
  age: number;
  wealthMultipleOfSalary: number;
  savingsRatePercent: number;
  notes: string;
};

const ageTargets: AgeBasedRetirementTarget[] = [
  {
    age: 25,
    wealthMultipleOfSalary: 0.0,
    savingsRatePercent: 15,
    notes:
      "Starting age for Fidelity's standard model. 15%-of-gross savings target assumes retirement at age 67."
  },
  {
    age: 30,
    wealthMultipleOfSalary: 1.0,
    savingsRatePercent: 15,
    notes: "By 30, aim to have 1x current salary saved."
  },
  {
    age: 35,
    wealthMultipleOfSalary: 2.0,
    savingsRatePercent: 15,
    notes: "By 35, aim to have 2x current salary saved."
  },
  {
    age: 40,
    wealthMultipleOfSalary: 3.0,
    savingsRatePercent: 15,
    notes: "By 40, aim to have 3x current salary saved."
  },
  {
    age: 45,
    wealthMultipleOfSalary: 4.0,
    savingsRatePercent: 15,
    notes: "By 45, aim to have 4x current salary saved."
  },
  {
    age: 50,
    wealthMultipleOfSalary: 6.0,
    savingsRatePercent: 20,
    notes:
      "By 50, aim for 6x. Catch-up contributions become available; consider raising savings rate."
  },
  {
    age: 55,
    wealthMultipleOfSalary: 7.0,
    savingsRatePercent: 20,
    notes: "By 55, aim for 7x current salary saved."
  },
  {
    age: 60,
    wealthMultipleOfSalary: 8.0,
    savingsRatePercent: 20,
    notes: "By 60, aim for 8x current salary saved."
  },
  {
    age: 67,
    wealthMultipleOfSalary: 10.0,
    savingsRatePercent: 15,
    notes:
      "Target retirement age for Fidelity's standard model; 10x salary covers ~45% income replacement alongside Social Security."
  }
];

export function getAgeBasedRetirementTarget(
  age: number
): AgeBasedRetirementTarget {
  // Find the closest age anchor to the user's actual age.
  const sortedByDistance = [...ageTargets].sort(
    (a, b) => Math.abs(a.age - age) - Math.abs(b.age - age)
  );
  return sortedByDistance[0];
}

export function listSupportedIrsYears(): number[] {
  return Object.keys(irsLimitsByYear)
    .map(Number)
    .sort((a, b) => a - b);
}
