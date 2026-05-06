-- Add budget_exceeded to ProactiveNudgeKind enum
ALTER TYPE "ProactiveNudgeKind" ADD VALUE IF NOT EXISTS 'budget_exceeded';
