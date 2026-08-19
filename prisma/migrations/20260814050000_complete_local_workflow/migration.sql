CREATE TYPE "public"."suspension_source" AS ENUM ('self', 'admin');

ALTER TABLE "public"."users"
ADD COLUMN "suspension_source" "public"."suspension_source";

ALTER TABLE "public"."reports"
ADD COLUMN "target_avatar_conversation_id" UUID;
