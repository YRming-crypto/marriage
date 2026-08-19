import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../prisma/migrations/20260814031000_platform_capabilities/migration.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const normalizedMigration = migration.replace(/\s+/g, " ");

describe("platform capabilities migration", () => {
  it.each([
    ["appeal_status", ["pending", "reviewing", "approved", "rejected"]],
    ["data_export_status", ["pending", "ready", "failed", "expired"]],
    ["content_type", ["post", "event", "story", "lesson"]],
    ["content_status", ["draft", "published", "offline"]],
    ["registration_status", ["registered", "cancelled"]],
    ["outbox_status", ["pending", "processing", "processed", "failed"]],
    ["maintenance_status", ["running", "succeeded", "failed"]],
  ])("creates the %s enum with mapped PostgreSQL values", (name, values) => {
    const quotedValues = values.map((value) => `'${value}'`).join(", ");
    expect(normalizedMigration).toContain(
      `CREATE TYPE "public"."${name}" AS ENUM (${quotedValues});`,
    );
  });

  it("adds nullable account-deletion and report-evidence references", () => {
    expect(normalizedMigration).toContain(
      'ALTER TABLE "public"."users" ADD COLUMN "deletion_requested_at" TIMESTAMP(3), ADD COLUMN "deletion_scheduled_at" TIMESTAMP(3);',
    );
    expect(normalizedMigration).toContain(
      'ALTER TABLE "public"."reports" ADD COLUMN "target_message_id" UUID, ADD COLUMN "target_conversation_id" UUID;',
    );
    expect(normalizedMigration).toContain(
      'ALTER TABLE "public"."profiles" ADD COLUMN "review_reason" VARCHAR(1000);',
    );
  });

  it("adds the encrypted export payload introduced by the current Schema", () => {
    const tableDefinition = normalizedMigration.split(
      'CREATE TABLE "public"."data_export_jobs" (',
    )[1]?.split('CONSTRAINT "data_export_jobs_pkey"')[0];
    expect(tableDefinition).toContain('"payload_ciphertext" TEXT');
  });

  it("creates the encrypted onboarding draft store without removing legacy profile data", () => {
    expect(normalizedMigration).toContain('CREATE TABLE "public"."onboarding_drafts" (');
    expect(normalizedMigration).toContain('"user_id" UUID NOT NULL');
    expect(normalizedMigration).toContain('"current_step" INTEGER NOT NULL DEFAULT 1');
    expect(normalizedMigration).toContain(
      '"status" "public"."onboarding_draft_status" NOT NULL DEFAULT \'in_progress\'',
    );
    expect(normalizedMigration).toContain('"data_ciphertext" TEXT NOT NULL');
    expect(normalizedMigration).toContain(
      'CREATE UNIQUE INDEX "onboarding_drafts_user_id_key" ON "public"."onboarding_drafts"("user_id");',
    );
    expect(normalizedMigration).toContain(
      'CREATE INDEX "onboarding_drafts_status_updated_at_idx" ON "public"."onboarding_drafts"("status", "updated_at");',
    );
    expect(normalizedMigration).toContain(
      'ALTER TABLE "public"."onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    );
    expect(migration).not.toMatch(/DROP\s+COLUMN/i);
  });

  it.each([
    "login_events",
    "account_appeals",
    "data_export_jobs",
    "saved_match_filters",
    "match_skips",
    "match_snapshots",
    "avatar_knowledge_items",
    "avatar_profile_versions",
    "model_call_logs",
    "message_receipts",
    "outbox_events",
    "admin_audit_logs",
    "content_items",
    "content_likes",
    "event_registrations",
    "maintenance_runs",
  ])("creates the %s table with a UUID primary key", (table) => {
    expect(normalizedMigration).toContain(`CREATE TABLE "public"."${table}" (`);
    expect(normalizedMigration).toContain(
      `CONSTRAINT "${table}_pkey" PRIMARY KEY ("id")`,
    );
    const tableDefinition = normalizedMigration.split(`CREATE TABLE "public"."${table}" (`)[1]?.split(
      `CONSTRAINT "${table}_pkey"`,
    )[0];
    expect(tableDefinition).toContain('"id" UUID NOT NULL');
  });

  it("uses JSONB for structured capability data", () => {
    for (const column of [
      '"evidence" JSONB',
      '"criteria" JSONB NOT NULL',
      '"reasons" JSONB NOT NULL',
      '"factors" JSONB',
      '"summary" JSONB NOT NULL',
      '"forbidden_topics" JSONB',
      '"metadata" JSONB',
      '"payload" JSONB NOT NULL',
      '"result" JSONB',
    ]) {
      expect(normalizedMigration).toContain(column);
    }
  });

  it.each([
    ['login_events_user_id_created_at_idx', '"login_events"("user_id", "created_at")'],
    ['account_appeals_user_id_created_at_idx', '"account_appeals"("user_id", "created_at")'],
    ['account_appeals_status_created_at_idx', '"account_appeals"("status", "created_at")'],
    ['data_export_jobs_user_id_created_at_idx', '"data_export_jobs"("user_id", "created_at")'],
    ['data_export_jobs_status_expires_at_idx', '"data_export_jobs"("status", "expires_at")'],
    ['saved_match_filters_user_id_updated_at_idx', '"saved_match_filters"("user_id", "updated_at")'],
    ['match_skips_user_id_created_at_idx', '"match_skips"("user_id", "created_at")'],
    ['match_snapshots_user_id_score_created_at_idx', '"match_snapshots"("user_id", "score", "created_at")'],
    ['match_snapshots_target_user_id_created_at_idx', '"match_snapshots"("target_user_id", "created_at")'],
    ['avatar_knowledge_items_profile_id_enabled_updated_at_idx', '"avatar_knowledge_items"("profile_id", "enabled", "updated_at")'],
    ['avatar_profile_versions_profile_id_created_at_idx', '"avatar_profile_versions"("profile_id", "created_at")'],
    ['model_call_logs_user_id_created_at_idx', '"model_call_logs"("user_id", "created_at")'],
    ['model_call_logs_status_created_at_idx', '"model_call_logs"("status", "created_at")'],
    ['message_receipts_user_id_read_at_created_at_idx', '"message_receipts"("user_id", "read_at", "created_at")'],
    ['outbox_events_status_available_at_idx', '"outbox_events"("status", "available_at")'],
    ['admin_audit_logs_actor_user_id_created_at_idx', '"admin_audit_logs"("actor_user_id", "created_at")'],
    ['admin_audit_logs_target_type_target_id_created_at_idx', '"admin_audit_logs"("target_type", "target_id", "created_at")'],
    ['content_items_type_status_published_at_idx', '"content_items"("type", "status", "published_at")'],
    ['content_likes_user_id_created_at_idx', '"content_likes"("user_id", "created_at")'],
    ['event_registrations_user_id_status_created_at_idx', '"event_registrations"("user_id", "status", "created_at")'],
    ['maintenance_runs_task_started_at_idx', '"maintenance_runs"("task", "started_at")'],
    ['maintenance_runs_status_started_at_idx', '"maintenance_runs"("status", "started_at")'],
  ])("creates index %s on the expected columns", (name, target) => {
    expect(normalizedMigration).toContain(
      `CREATE INDEX "${name}" ON "public".${target};`,
    );
  });

  it.each([
    ['match_skips_user_id_target_user_id_key', '"match_skips"("user_id", "target_user_id")'],
    ['avatar_profile_versions_profile_id_version_key', '"avatar_profile_versions"("profile_id", "version")'],
    ['message_receipts_message_id_user_id_key', '"message_receipts"("message_id", "user_id")'],
    ['content_likes_content_id_user_id_key', '"content_likes"("content_id", "user_id")'],
    ['event_registrations_content_id_user_id_key', '"event_registrations"("content_id", "user_id")'],
  ])("creates unique index %s on the expected columns", (name, target) => {
    expect(normalizedMigration).toContain(
      `CREATE UNIQUE INDEX "${name}" ON "public".${target};`,
    );
  });

  it.each([
    ['avatar_knowledge_items_profile_id_fkey', 'avatar_knowledge_items', 'profile_id', 'profiles'],
    ['avatar_profile_versions_profile_id_fkey', 'avatar_profile_versions', 'profile_id', 'profiles'],
    ['message_receipts_message_id_fkey', 'message_receipts', 'message_id', 'messages'],
    ['content_likes_content_id_fkey', 'content_likes', 'content_id', 'content_items'],
    ['event_registrations_content_id_fkey', 'event_registrations', 'content_id', 'content_items'],
  ])("creates foreign key %s with the Schema delete behavior", (name, table, column, target) => {
    expect(normalizedMigration).toContain(
      `ALTER TABLE "public"."${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "public"."${target}"("id") ON DELETE CASCADE ON UPDATE CASCADE;`,
    );
  });

  it("does not repeat the message idempotency index from the preceding migration", () => {
    expect(migration).not.toContain("messages_conversation_id_client_message_id_key");
    expect(migration).not.toContain("messages_conversation_id_sender_id_client_message_id_key");
  });
});
