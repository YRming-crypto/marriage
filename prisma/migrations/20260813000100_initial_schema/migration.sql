-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."user_status" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "public"."user_role" AS ENUM ('user', 'moderator', 'admin');

-- CreateEnum
CREATE TYPE "public"."otp_purpose" AS ENUM ('login', 'register');

-- CreateEnum
CREATE TYPE "public"."gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "public"."marital_status" AS ENUM ('single', 'divorced', 'widowed');

-- CreateEnum
CREATE TYPE "public"."relationship_goal" AS ENUM ('serious_dating', 'marriage', 'get_to_know');

-- CreateEnum
CREATE TYPE "public"."profile_status" AS ENUM ('draft', 'pending_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "public"."profile_visibility" AS ENUM ('private', 'approved_only', 'public');

-- CreateEnum
CREATE TYPE "public"."onboarding_draft_status" AS ENUM ('in_progress', 'submitted');

-- CreateEnum
CREATE TYPE "public"."ai_consent_status" AS ENUM ('pending', 'enabled', 'paused', 'revoked');

-- CreateEnum
CREATE TYPE "public"."photo_review_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "public"."interest_status" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "public"."avatar_conversation_status" AS ENUM ('active', 'completed', 'blocked');

-- CreateEnum
CREATE TYPE "public"."avatar_message_sender" AS ENUM ('user', 'avatar', 'system');

-- CreateEnum
CREATE TYPE "public"."message_moderation_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "public"."chat_request_status" AS ENUM ('ai_learning', 'ready', 'pending', 'accepted', 'rejected', 'expired', 'blocked');

-- CreateEnum
CREATE TYPE "public"."conversation_status" AS ENUM ('active', 'archived', 'blocked');

-- CreateEnum
CREATE TYPE "public"."message_type" AS ENUM ('text', 'system');

-- CreateEnum
CREATE TYPE "public"."notification_type" AS ENUM ('photo_reviewed', 'profile_reviewed', 'chat_request_received', 'chat_request_accepted', 'chat_request_rejected', 'new_message', 'system');

-- CreateEnum
CREATE TYPE "public"."moderation_target_type" AS ENUM ('photo', 'profile', 'message', 'user');

-- CreateEnum
CREATE TYPE "public"."moderation_task_status" AS ENUM ('pending', 'approved', 'rejected', 'escalated');

-- CreateEnum
CREATE TYPE "public"."report_status" AS ENUM ('pending', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "phone_hash" VARCHAR(128) NOT NULL,
    "phone_encrypted" TEXT,
    "status" "public"."user_status" NOT NULL DEFAULT 'active',
    "role" "public"."user_role" NOT NULL DEFAULT 'user',
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(128) NOT NULL,
    "user_agent" VARCHAR(512),
    "ip_hash" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."otp_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "phone_hash" VARCHAR(128) NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "purpose" "public"."otp_purpose" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "ip_hash" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "nickname" VARCHAR(40) NOT NULL,
    "gender" "public"."gender" NOT NULL,
    "birth_year" INTEGER NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "district" VARCHAR(80),
    "job_category" VARCHAR(80),
    "marital_status" "public"."marital_status" NOT NULL,
    "goal" "public"."relationship_goal" NOT NULL,
    "introduction" VARCHAR(1000),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preference" JSONB,
    "profile_status" "public"."profile_status" NOT NULL DEFAULT 'draft',
    "visibility" "public"."profile_visibility" NOT NULL DEFAULT 'approved_only',
    "onboarding_draft_status" "public"."onboarding_draft_status",
    "onboarding_current_step" INTEGER,
    "onboarding_draft" JSONB,
    "onboarding_answers_ciphertext" TEXT,
    "onboarding_answers_version" INTEGER,
    "onboarding_completed_at" TIMESTAMP(3),
    "ai_profile_version" INTEGER NOT NULL DEFAULT 0,
    "ai_profile_summary" JSONB,
    "ai_forbidden_topics" JSONB,
    "ai_consent_status" "public"."ai_consent_status" NOT NULL DEFAULT 'pending',
    "ai_generated_at" TIMESTAMP(3),
    "ai_approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "url" TEXT,
    "mime_type" VARCHAR(80) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "review_status" "public"."photo_review_status" NOT NULL DEFAULT 'pending',
    "review_reason" VARCHAR(500),
    "reviewed_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "uploaded_at" TIMESTAMP(3),

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."interests" (
    "id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "status" "public"."interest_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."avatar_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "status" "public"."avatar_conversation_status" NOT NULL DEFAULT 'active',
    "completed_topics" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."avatar_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_type" "public"."avatar_message_sender" NOT NULL,
    "content_ciphertext" TEXT NOT NULL,
    "model_name" VARCHAR(120),
    "prompt_version" VARCHAR(80),
    "moderation_status" "public"."message_moderation_status" NOT NULL DEFAULT 'pending',
    "safety_reason" VARCHAR(500),
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avatar_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chat_requests" (
    "id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "interest_id" UUID,
    "source_avatar_conversation_id" UUID,
    "status" "public"."chat_request_status" NOT NULL DEFAULT 'ai_learning',
    "compatibility_score" INTEGER,
    "compatibility_summary" JSONB,
    "readiness_reason" VARCHAR(500),
    "last_evaluated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" UUID NOT NULL,
    "chat_request_id" UUID,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "status" "public"."conversation_status" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "type" "public"."message_type" NOT NULL DEFAULT 'text',
    "content_ciphertext" TEXT NOT NULL,
    "moderation_status" "public"."message_moderation_status" NOT NULL DEFAULT 'pending',
    "moderation_reason" VARCHAR(500),
    "client_message_id" VARCHAR(100),
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "public"."notification_type" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "related_resource_type" VARCHAR(40),
    "related_resource_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."moderation_tasks" (
    "id" UUID NOT NULL,
    "target_type" "public"."moderation_target_type" NOT NULL,
    "target_photo_id" UUID,
    "target_profile_id" UUID,
    "target_message_id" UUID,
    "target_user_id" UUID,
    "status" "public"."moderation_task_status" NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "assigned_to_user_id" UUID,
    "decided_by_user_id" UUID,
    "decision_reason" VARCHAR(1000),
    "result_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "moderation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reports" (
    "id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "reason" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "status" "public"."report_status" NOT NULL DEFAULT 'pending',
    "resolution" VARCHAR(1000),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."blocks" (
    "id" UUID NOT NULL,
    "blocker_user_id" UUID NOT NULL,
    "blocked_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_hash_key" ON "public"."users"("phone_hash");

-- CreateIndex
CREATE INDEX "users_status_created_at_idx" ON "public"."users"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "public"."sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_expires_at_idx" ON "public"."sessions"("user_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "otp_requests_phone_hash_purpose_created_at_idx" ON "public"."otp_requests"("phone_hash", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "otp_requests_expires_at_used_at_idx" ON "public"."otp_requests"("expires_at", "used_at");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "public"."profiles"("user_id");

-- CreateIndex
CREATE INDEX "profiles_profile_status_visibility_city_idx" ON "public"."profiles"("profile_status", "visibility", "city");

-- CreateIndex
CREATE INDEX "profiles_gender_birth_year_marital_status_goal_idx" ON "public"."profiles"("gender", "birth_year", "marital_status", "goal");

-- CreateIndex
CREATE UNIQUE INDEX "photos_object_key_key" ON "public"."photos"("object_key");

-- CreateIndex
CREATE INDEX "photos_user_id_review_status_is_primary_idx" ON "public"."photos"("user_id", "review_status", "is_primary");

-- CreateIndex
CREATE INDEX "interests_to_user_id_status_created_at_idx" ON "public"."interests"("to_user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "interests_from_user_id_to_user_id_key" ON "public"."interests"("from_user_id", "to_user_id");

-- CreateIndex
CREATE INDEX "avatar_conversations_user_id_status_last_message_at_idx" ON "public"."avatar_conversations"("user_id", "status", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "avatar_conversations_user_id_target_user_id_key" ON "public"."avatar_conversations"("user_id", "target_user_id");

-- CreateIndex
CREATE INDEX "avatar_messages_conversation_id_created_at_idx" ON "public"."avatar_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_requests_interest_id_key" ON "public"."chat_requests"("interest_id");

-- CreateIndex
CREATE INDEX "chat_requests_target_user_id_status_created_at_idx" ON "public"."chat_requests"("target_user_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_requests_requester_id_target_user_id_key" ON "public"."chat_requests"("requester_id", "target_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_chat_request_id_key" ON "public"."conversations"("chat_request_id");

-- CreateIndex
CREATE INDEX "conversations_user_a_id_status_updated_at_idx" ON "public"."conversations"("user_a_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "conversations_user_b_id_status_updated_at_idx" ON "public"."conversations"("user_b_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_user_a_id_user_b_id_key" ON "public"."conversations"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "public"."messages"("conversation_id", "sent_at");

-- CreateIndex
CREATE INDEX "messages_sender_id_created_at_idx" ON "public"."messages"("sender_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_client_message_id_key" ON "public"."messages"("conversation_id", "client_message_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "public"."notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "moderation_tasks_status_priority_created_at_idx" ON "public"."moderation_tasks"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "moderation_tasks_target_type_status_created_at_idx" ON "public"."moderation_tasks"("target_type", "status", "created_at");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "public"."reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_user_id_status_created_at_idx" ON "public"."reports"("target_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "blocks_blocked_user_id_created_at_idx" ON "public"."blocks"("blocked_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_blocker_user_id_blocked_user_id_key" ON "public"."blocks"("blocker_user_id", "blocked_user_id");

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."otp_requests" ADD CONSTRAINT "otp_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."photos" ADD CONSTRAINT "photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."photos" ADD CONSTRAINT "photos_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."interests" ADD CONSTRAINT "interests_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."interests" ADD CONSTRAINT "interests_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."avatar_conversations" ADD CONSTRAINT "avatar_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."avatar_conversations" ADD CONSTRAINT "avatar_conversations_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."avatar_messages" ADD CONSTRAINT "avatar_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."avatar_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_requests" ADD CONSTRAINT "chat_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_requests" ADD CONSTRAINT "chat_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_requests" ADD CONSTRAINT "chat_requests_interest_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_requests" ADD CONSTRAINT "chat_requests_source_avatar_conversation_id_fkey" FOREIGN KEY ("source_avatar_conversation_id") REFERENCES "public"."avatar_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_chat_request_id_fkey" FOREIGN KEY ("chat_request_id") REFERENCES "public"."chat_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."moderation_tasks" ADD CONSTRAINT "moderation_tasks_target_photo_id_fkey" FOREIGN KEY ("target_photo_id") REFERENCES "public"."photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."moderation_tasks" ADD CONSTRAINT "moderation_tasks_target_profile_id_fkey" FOREIGN KEY ("target_profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."moderation_tasks" ADD CONSTRAINT "moderation_tasks_target_message_id_fkey" FOREIGN KEY ("target_message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."moderation_tasks" ADD CONSTRAINT "moderation_tasks_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."moderation_tasks" ADD CONSTRAINT "moderation_tasks_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."moderation_tasks" ADD CONSTRAINT "moderation_tasks_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reports" ADD CONSTRAINT "reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reports" ADD CONSTRAINT "reports_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reports" ADD CONSTRAINT "reports_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."blocks" ADD CONSTRAINT "blocks_blocker_user_id_fkey" FOREIGN KEY ("blocker_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."blocks" ADD CONSTRAINT "blocks_blocked_user_id_fkey" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
