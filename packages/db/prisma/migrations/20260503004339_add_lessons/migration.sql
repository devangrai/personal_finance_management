-- CreateEnum
CREATE TYPE "LessonKind" AS ENUM ('preference', 'advice_lesson');

-- CreateEnum
CREATE TYPE "LessonTopic" AS ENUM ('tax', 'retirement', 'spending', 'portfolio', 'goals', 'general');

-- CreateEnum
CREATE TYPE "CandidateLessonStatus" AS ENUM ('pending', 'graduated', 'rejected', 'reopened');

-- CreateTable
CREATE TABLE "CandidateLesson" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "LessonKind" NOT NULL,
    "topic" "LessonTopic" NOT NULL,
    "patternSummary" TEXT NOT NULL,
    "evidenceRunIds" JSONB NOT NULL,
    "clusterStrength" INTEGER NOT NULL,
    "status" "CandidateLessonStatus" NOT NULL DEFAULT 'pending',
    "rationale" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentLesson" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "LessonKind" NOT NULL,
    "topic" "LessonTopic" NOT NULL,
    "patternSummary" TEXT NOT NULL,
    "actionOrCaveat" TEXT NOT NULL,
    "evidenceRunIds" JSONB NOT NULL,
    "relevanceKeywords" JSONB NOT NULL,
    "rationale" TEXT,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "candidateLessonId" TEXT,
    "graduatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentLesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateLesson_userId_status_idx" ON "CandidateLesson"("userId", "status");

-- CreateIndex
CREATE INDEX "CandidateLesson_userId_topic_status_idx" ON "CandidateLesson"("userId", "topic", "status");

-- CreateIndex
CREATE INDEX "AgentLesson_userId_topic_idx" ON "AgentLesson"("userId", "topic");

-- CreateIndex
CREATE INDEX "AgentLesson_userId_kind_topic_idx" ON "AgentLesson"("userId", "kind", "topic");

-- AddForeignKey
ALTER TABLE "CandidateLesson" ADD CONSTRAINT "CandidateLesson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentLesson" ADD CONSTRAINT "AgentLesson_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
