import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../prisma/migrations/20260814190000_avatar_conversation_rounds/migration.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const normalizedMigration = migration.replace(/\s+/g, " ");

describe("avatar conversation rounds migration", () => {
  it("replaces the pair uniqueness constraint with a non-unique lookup index", () => {
    expect(normalizedMigration).toContain(
      'DROP INDEX "public"."avatar_conversations_user_id_target_user_id_key";',
    );
    expect(normalizedMigration).toContain(
      'CREATE INDEX "avatar_conversations_user_id_target_user_id_created_at_idx" ON "public"."avatar_conversations"("user_id", "target_user_id", "created_at");',
    );
    expect(normalizedMigration).not.toContain(
      'CREATE UNIQUE INDEX "avatar_conversations_user_id_target_user_id_created_at_idx"',
    );
  });
});
