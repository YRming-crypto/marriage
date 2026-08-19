DROP INDEX "public"."avatar_conversations_user_id_target_user_id_key";

CREATE INDEX "avatar_conversations_user_id_target_user_id_created_at_idx"
ON "public"."avatar_conversations"("user_id", "target_user_id", "created_at");
