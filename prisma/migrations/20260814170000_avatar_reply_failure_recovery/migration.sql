CREATE TYPE "public"."avatar_reply_failure_status" AS ENUM ('pending', 'resolved');

ALTER TABLE "public"."avatar_messages"
ADD COLUMN "client_message_id" VARCHAR(120);

CREATE UNIQUE INDEX "avatar_messages_conversation_id_client_message_id_sender_type_key"
ON "public"."avatar_messages"("conversation_id", "client_message_id", "sender_type");

CREATE TABLE "public"."avatar_reply_failure_tasks" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_message_id" UUID NOT NULL,
    "member_id" VARCHAR(120) NOT NULL,
    "status" "public"."avatar_reply_failure_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error" VARCHAR(200),
    "resolved_message_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "avatar_reply_failure_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "avatar_reply_failure_tasks_user_message_id_key"
ON "public"."avatar_reply_failure_tasks"("user_message_id");

CREATE UNIQUE INDEX "avatar_reply_failure_tasks_resolved_message_id_key"
ON "public"."avatar_reply_failure_tasks"("resolved_message_id");

CREATE INDEX "avatar_reply_failure_tasks_status_created_at_idx"
ON "public"."avatar_reply_failure_tasks"("status", "created_at");

CREATE INDEX "avatar_reply_failure_tasks_session_id_created_at_idx"
ON "public"."avatar_reply_failure_tasks"("session_id", "created_at");

ALTER TABLE "public"."avatar_reply_failure_tasks"
ADD CONSTRAINT "avatar_reply_failure_tasks_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "public"."avatar_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."avatar_reply_failure_tasks"
ADD CONSTRAINT "avatar_reply_failure_tasks_user_message_id_fkey"
FOREIGN KEY ("user_message_id") REFERENCES "public"."avatar_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."avatar_reply_failure_tasks"
ADD CONSTRAINT "avatar_reply_failure_tasks_resolved_message_id_fkey"
FOREIGN KEY ("resolved_message_id") REFERENCES "public"."avatar_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
