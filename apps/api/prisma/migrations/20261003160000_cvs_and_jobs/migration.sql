-- CreateEnum
CREATE TYPE "CvStatus" AS ENUM ('generating', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('pdf', 'free_text', 'answer', 'manual');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('generate', 'apply_answer');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('queued', 'extracting', 'generating', 'validating', 'applying', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('missing', 'vague', 'unverified');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('open', 'applying', 'answered', 'dismissed', 'resolved', 'failed');

-- CreateTable
CREATE TABLE "cvs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL,
    "status" "CvStatus" NOT NULL DEFAULT 'generating',
    "failureCode" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "document" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "aiRevision" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cvs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_texts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cvId" UUID NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_uploads" (
    "cvId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_uploads_pkey" PRIMARY KEY ("cvId")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cvId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "stage" "JobStage" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "questionId" UUID,
    "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cvId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "priority" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'open',
    "answer" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grounding_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cvId" UUID NOT NULL,
    "jobId" UUID,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "items" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grounding_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_snapshots" (
    "cvId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "section" JSONB NOT NULL,
    "aiRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_snapshots_pkey" PRIMARY KEY ("cvId")
);

-- CreateIndex
CREATE INDEX "cvs_userId_updatedAt_idx" ON "cvs"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cvs_userId_idempotencyKey_key" ON "cvs"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "source_texts_cvId_createdAt_idx" ON "source_texts"("cvId", "createdAt");

-- CreateIndex
CREATE INDEX "pdf_uploads_createdAt_idx" ON "pdf_uploads"("createdAt");

-- CreateIndex
CREATE INDEX "jobs_status_createdAt_idx" ON "jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "jobs_userId_status_idx" ON "jobs"("userId", "status");

-- CreateIndex
CREATE INDEX "jobs_cvId_createdAt_idx" ON "jobs"("cvId", "createdAt");

-- CreateIndex
CREATE INDEX "questions_cvId_status_idx" ON "questions"("cvId", "status");

-- CreateIndex
CREATE INDEX "grounding_reports_cvId_createdAt_idx" ON "grounding_reports"("cvId", "createdAt");

-- AddForeignKey
ALTER TABLE "cvs" ADD CONSTRAINT "cvs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_texts" ADD CONSTRAINT "source_texts_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_uploads" ADD CONSTRAINT "pdf_uploads_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grounding_reports" ADD CONSTRAINT "grounding_reports_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_snapshots" ADD CONSTRAINT "ai_snapshots_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "cvs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One active generation per CV (AC-5.8). Prisma cannot declare a partial index and ignores
-- this one when diffing, so future migrations leave it alone.
CREATE UNIQUE INDEX "jobs_one_active_generation_per_cv" ON "jobs"("cvId")
    WHERE "type" = 'generate' AND "status" IN ('queued', 'running');
