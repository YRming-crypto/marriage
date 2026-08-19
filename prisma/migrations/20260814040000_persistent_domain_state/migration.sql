-- CreateEnum
CREATE TYPE "public"."knowledge_governance_status" AS ENUM ('allowed', 'sensitive', 'prohibited');

-- CreateEnum
CREATE TYPE "public"."avatar_profile_version_status" AS ENUM ('draft', 'active', 'stale', 'archived');

-- AlterTable
ALTER TABLE "public"."avatar_knowledge_items"
ADD COLUMN "title" VARCHAR(120),
ADD COLUMN "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "governance_status" "public"."knowledge_governance_status" NOT NULL DEFAULT 'allowed',
ADD COLUMN "moderation_reason" VARCHAR(500),
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

UPDATE "public"."avatar_knowledge_items" SET "title" = "topic" WHERE "title" IS NULL;
ALTER TABLE "public"."avatar_knowledge_items" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "public"."avatar_knowledge_items" ALTER COLUMN "source" SET DEFAULT 'manual';

-- AlterTable
ALTER TABLE "public"."avatar_profile_versions"
ADD COLUMN "status" "public"."avatar_profile_version_status" NOT NULL DEFAULT 'draft',
ADD COLUMN "note" VARCHAR(500),
ADD COLUMN "activated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."content_items"
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "event_ends_at" TIMESTAMP(3),
ADD COLUMN "offline_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."event_registrations"
ADD COLUMN "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "cancelled_at" TIMESTAMP(3);
