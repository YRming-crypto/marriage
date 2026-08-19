-- CreateEnum
CREATE TYPE "public"."appeal_status" AS ENUM ('pending', 'reviewing', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "public"."data_export_status" AS ENUM ('pending', 'ready', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "public"."content_type" AS ENUM ('post', 'event', 'story', 'lesson');

-- CreateEnum
CREATE TYPE "public"."content_status" AS ENUM ('draft', 'published', 'offline');

-- CreateEnum
CREATE TYPE "public"."registration_status" AS ENUM ('registered', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."outbox_status" AS ENUM ('pending', 'processing', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "public"."maintenance_status" AS ENUM ('running', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "public"."users"
ADD COLUMN "deletion_requested_at" TIMESTAMP(3),
ADD COLUMN "deletion_scheduled_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."reports"
ADD COLUMN "target_message_id" UUID,
ADD COLUMN "target_conversation_id" UUID;

-- AlterTable
ALTER TABLE "public"."profiles"
ADD COLUMN "review_reason" VARCHAR(1000);

-- CreateTable
CREATE TABLE "public"."onboarding_drafts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "status" "public"."onboarding_draft_status" NOT NULL DEFAULT 'in_progress',
    "data_ciphertext" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "onboarding_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."login_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "ip_hash" VARCHAR(128),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."account_appeals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "evidence" JSONB,
    "status" "public"."appeal_status" NOT NULL DEFAULT 'pending',
    "resolution" VARCHAR(1000),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "account_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."data_export_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "public"."data_export_status" NOT NULL DEFAULT 'pending',
    "object_key" VARCHAR(512),
    "download_url" TEXT,
    "payload_ciphertext" TEXT,
    "error" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "data_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."saved_match_filters" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "criteria" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_match_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."match_skips" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_skips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."match_snapshots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "algorithm_version" VARCHAR(80) NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "factors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."avatar_knowledge_items" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "topic" VARCHAR(120) NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "source" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "visibility" VARCHAR(40) NOT NULL DEFAULT 'avatar_only',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."avatar_profile_versions" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "forbidden_topics" JSONB,
    "prompt_version" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."model_call_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "avatar_conversation_id" UUID,
    "provider" VARCHAR(80) NOT NULL,
    "model_name" VARCHAR(120) NOT NULL,
    "prompt_version" VARCHAR(80) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "error" VARCHAR(1000),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."message_receipts" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" VARCHAR(120) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."outbox_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(120),
    "reason" VARCHAR(1000),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."content_items" (
    "id" UUID NOT NULL,
    "type" "public"."content_type" NOT NULL,
    "status" "public"."content_status" NOT NULL DEFAULT 'draft',
    "title" VARCHAR(160) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "cover_url" TEXT,
    "location" VARCHAR(160),
    "event_starts_at" TIMESTAMP(3),
    "capacity" INTEGER,
    "published_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."content_likes" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_registrations" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "public"."registration_status" NOT NULL DEFAULT 'registered',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."maintenance_runs" (
    "id" UUID NOT NULL,
    "task" VARCHAR(120) NOT NULL,
    "status" "public"."maintenance_status" NOT NULL DEFAULT 'running',
    "triggered_by" VARCHAR(120) NOT NULL,
    "result" JSONB,
    "error" VARCHAR(1000),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "maintenance_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_drafts_user_id_key" ON "public"."onboarding_drafts"("user_id");

-- CreateIndex
CREATE INDEX "onboarding_drafts_status_updated_at_idx" ON "public"."onboarding_drafts"("status", "updated_at");

-- CreateIndex
CREATE INDEX "login_events_user_id_created_at_idx" ON "public"."login_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "account_appeals_user_id_created_at_idx" ON "public"."account_appeals"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "account_appeals_status_created_at_idx" ON "public"."account_appeals"("status", "created_at");

-- CreateIndex
CREATE INDEX "data_export_jobs_user_id_created_at_idx" ON "public"."data_export_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "data_export_jobs_status_expires_at_idx" ON "public"."data_export_jobs"("status", "expires_at");

-- CreateIndex
CREATE INDEX "saved_match_filters_user_id_updated_at_idx" ON "public"."saved_match_filters"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_skips_user_id_target_user_id_key" ON "public"."match_skips"("user_id", "target_user_id");

-- CreateIndex
CREATE INDEX "match_skips_user_id_created_at_idx" ON "public"."match_skips"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "match_snapshots_user_id_score_created_at_idx" ON "public"."match_snapshots"("user_id", "score", "created_at");

-- CreateIndex
CREATE INDEX "match_snapshots_target_user_id_created_at_idx" ON "public"."match_snapshots"("target_user_id", "created_at");

-- CreateIndex
CREATE INDEX "avatar_knowledge_items_profile_id_enabled_updated_at_idx" ON "public"."avatar_knowledge_items"("profile_id", "enabled", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_profile_versions_profile_id_version_key" ON "public"."avatar_profile_versions"("profile_id", "version");

-- CreateIndex
CREATE INDEX "avatar_profile_versions_profile_id_created_at_idx" ON "public"."avatar_profile_versions"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "model_call_logs_user_id_created_at_idx" ON "public"."model_call_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "model_call_logs_status_created_at_idx" ON "public"."model_call_logs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_receipts_message_id_user_id_key" ON "public"."message_receipts"("message_id", "user_id");

-- CreateIndex
CREATE INDEX "message_receipts_user_id_read_at_created_at_idx" ON "public"."message_receipts"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "public"."outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actor_user_id_created_at_idx" ON "public"."admin_audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_target_id_created_at_idx" ON "public"."admin_audit_logs"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "content_items_type_status_published_at_idx" ON "public"."content_items"("type", "status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_likes_content_id_user_id_key" ON "public"."content_likes"("content_id", "user_id");

-- CreateIndex
CREATE INDEX "content_likes_user_id_created_at_idx" ON "public"."content_likes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_registrations_content_id_user_id_key" ON "public"."event_registrations"("content_id", "user_id");

-- CreateIndex
CREATE INDEX "event_registrations_user_id_status_created_at_idx" ON "public"."event_registrations"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "maintenance_runs_task_started_at_idx" ON "public"."maintenance_runs"("task", "started_at");

-- CreateIndex
CREATE INDEX "maintenance_runs_status_started_at_idx" ON "public"."maintenance_runs"("status", "started_at");

-- AddForeignKey
ALTER TABLE "public"."onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."avatar_knowledge_items" ADD CONSTRAINT "avatar_knowledge_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."avatar_profile_versions" ADD CONSTRAINT "avatar_profile_versions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."message_receipts" ADD CONSTRAINT "message_receipts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_likes" ADD CONSTRAINT "content_likes_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."event_registrations" ADD CONSTRAINT "event_registrations_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
