import { relationshipQuestions } from "@ai-marriage/shared";
import { describe, expect, it } from "vitest";
import type { ObjectStorageProvider } from "./providers/index.js";
import { createMemoryStore } from "./store/index.js";
import type {
  Store,
  StoredAvatarProfile,
  StoredPhoto,
  StoredProfile,
  StoredUser,
} from "./store/types.js";
import {
  DATABASE_SEED_ADMIN,
  DATABASE_SEED_MEMBERS,
  seedDatabase,
  type DatabaseSeedPersistence,
} from "./database-seed.js";

class MemorySeedPersistence implements DatabaseSeedPersistence {
  readonly state = createMemoryStore([]);
  readonly hiddenPhoneLookups = new Map<string, StoredUser>();
  failPhotoId: string | null = null;

  async hydrate(target: Store) {
    for (const key of ["users", "usersByPhone", "profiles", "photos", "avatarProfiles"] as const) {
      for (const [id, value] of this.state[key]) target[key].set(id, structuredClone(value) as never);
    }
  }

  async persistUser(user: StoredUser) {
    const hidden = this.hiddenPhoneLookups.get(user.phone);
    if (hidden && hidden.id !== user.id) throw new Error("duplicate phone hash");
    this.state.users.set(user.id, structuredClone(user));
    this.state.usersByPhone.set(user.phone, user.id);
  }

  async findUserByPhone(phone: string) {
    const hidden = this.hiddenPhoneLookups.get(phone);
    if (hidden) return structuredClone(hidden);
    const userId = this.state.usersByPhone.get(phone);
    const user = userId ? this.state.users.get(userId) : undefined;
    return user ? structuredClone(user) : undefined;
  }

  async persistProfile(profile: StoredProfile) {
    this.state.profiles.set(profile.userId, structuredClone(profile));
  }

  async persistPhoto(photo: StoredPhoto) {
    if (photo.id === this.failPhotoId) throw new Error("photo persistence failed");
    this.state.photos.set(photo.id, structuredClone(photo));
  }

  async persistAvatarProfile(profile: StoredAvatarProfile) {
    this.state.avatarProfiles.set(profile.userId, structuredClone(profile));
  }
}

class MemorySeedObjects implements ObjectStorageProvider {
  readonly uploads: Array<{ filename: string; key: string }> = [];
  readonly deleted: string[] = [];

  async upload(request: { userId: string; filename: string; mimeType: string; data: Buffer }) {
    const key = `seed/${request.userId}/${request.filename}`;
    this.uploads.push({ filename: request.filename, key });
    return { key, url: `http://objects.local/${key}` };
  }

  async read() {
    return { data: Buffer.from("seed"), mimeType: "image/jpeg" };
  }

  async delete(key: string) {
    this.deleted.push(key);
  }
}

function createOptions(persistence = new MemorySeedPersistence(), objectStorage = new MemorySeedObjects()) {
  return {
    persistence,
    objectStorage,
    loadPhoto: async (filename: string) => Buffer.from(`image:${filename}`),
    now: () => new Date("2026-08-14T08:00:00.000Z"),
  };
}

describe("database seed", () => {
  it("creates filterable member profiles using the shared relationship questions", async () => {
    const persistence = new MemorySeedPersistence();

    await seedDatabase(createOptions(persistence));

    const profiles = DATABASE_SEED_MEMBERS.map((member) => persistence.state.profiles.get(member.id)!);
    const smokingStatuses = profiles.map((profile) => profile.preference.selfSmokingStatus);
    const childrenStatuses = profiles.map((profile) => profile.preference.selfChildrenStatus);

    expect(smokingStatuses).toEqual(expect.arrayContaining(["不吸烟", "偶尔吸烟", "吸烟"]));
    expect(childrenStatuses).toEqual(expect.arrayContaining(["无子女", "有子女", "子女已成年"]));
    for (const profile of profiles) {
      expect(["不吸烟", "偶尔吸烟", "吸烟"]).toContain(profile.preference.selfSmokingStatus);
      expect(["无子女", "有子女", "子女已成年"]).toContain(profile.preference.selfChildrenStatus);
      expect(Object.keys(profile.answers)).toEqual(relationshipQuestions);
    }
  });

  it("creates an admin and complete public member projections on a fresh database", async () => {
    const persistence = new MemorySeedPersistence();
    const objectStorage = new MemorySeedObjects();

    const report = await seedDatabase(createOptions(persistence, objectStorage));

    expect(report).toEqual({
      usersCreated: DATABASE_SEED_MEMBERS.length + 1,
      profilesCreated: DATABASE_SEED_MEMBERS.length,
      photosCreated: DATABASE_SEED_MEMBERS.length,
      avatarsCreated: DATABASE_SEED_MEMBERS.length,
      preservedAccounts: 0,
    });
    expect(persistence.state.users.get(DATABASE_SEED_ADMIN.id)).toMatchObject({
      phone: DATABASE_SEED_ADMIN.phone,
      role: "admin",
      status: "active",
    });
    for (const member of DATABASE_SEED_MEMBERS) {
      expect(persistence.state.profiles.get(member.id)).toMatchObject({
        userId: member.id,
        nickname: member.nickname,
        profileStatus: "approved",
        visibility: "public",
      });
      expect([...persistence.state.photos.values()].find((photo) => photo.userId === member.id)).toMatchObject({
        id: member.photoId,
        reviewStatus: "approved",
        isPrimary: true,
      });
      expect(persistence.state.avatarProfiles.get(member.id)).toMatchObject({
        status: "enabled",
        version: 1,
      });
    }
    expect(objectStorage.uploads).toHaveLength(DATABASE_SEED_MEMBERS.length);
  });

  it("is idempotent and preserves all existing seeded records", async () => {
    const persistence = new MemorySeedPersistence();
    const objectStorage = new MemorySeedObjects();
    const options = createOptions(persistence, objectStorage);

    await seedDatabase(options);
    const originalProfile = structuredClone(persistence.state.profiles.get(DATABASE_SEED_MEMBERS[0].id));
    const secondReport = await seedDatabase(options);

    expect(secondReport).toEqual({
      usersCreated: 0,
      profilesCreated: 0,
      photosCreated: 0,
      avatarsCreated: 0,
      preservedAccounts: DATABASE_SEED_MEMBERS.length + 1,
    });
    expect(objectStorage.uploads).toHaveLength(DATABASE_SEED_MEMBERS.length);
    expect(persistence.state.profiles.get(DATABASE_SEED_MEMBERS[0].id)).toEqual(originalProfile);
  });

  it("does not attach demo data to an existing real account using a seed phone", async () => {
    const persistence = new MemorySeedPersistence();
    const objectStorage = new MemorySeedObjects();
    const member = DATABASE_SEED_MEMBERS[0];
    const existingUser: StoredUser = {
      id: "90000000-0000-4000-8000-000000000001",
      phone: member.phone,
      role: "user",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    await persistence.persistUser(existingUser);

    const report = await seedDatabase(createOptions(persistence, objectStorage));

    expect(report.preservedAccounts).toBe(1);
    expect(persistence.state.users.get(existingUser.id)).toEqual(existingUser);
    expect(persistence.state.profiles.has(existingUser.id)).toBe(false);
    expect(persistence.state.profiles.has(member.id)).toBe(false);
    expect(objectStorage.uploads.some((upload) => upload.filename === member.photoFilename)).toBe(false);
  });

  it("preserves a matching phone hash even when hydration cannot decrypt the phone", async () => {
    const persistence = new MemorySeedPersistence();
    const member = DATABASE_SEED_MEMBERS[0];
    persistence.hiddenPhoneLookups.set(member.phone, {
      id: "90000000-0000-4000-8000-000000000002",
      phone: member.phone,
      role: "user",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    persistence.state.users.set("90000000-0000-4000-8000-000000000002", {
      ...persistence.hiddenPhoneLookups.get(member.phone)!,
      phone: "unknown-90000000-0000-4000-8000-000000000002",
    });

    const report = await seedDatabase(createOptions(persistence));

    expect(report.preservedAccounts).toBe(1);
    expect(persistence.state.profiles.has(member.id)).toBe(false);
  });

  it("removes an uploaded object when the photo row cannot be persisted", async () => {
    const persistence = new MemorySeedPersistence();
    const objectStorage = new MemorySeedObjects();
    persistence.failPhotoId = DATABASE_SEED_MEMBERS[0].photoId;

    await expect(seedDatabase(createOptions(persistence, objectStorage))).rejects.toThrow("photo persistence failed");

    expect(objectStorage.deleted).toEqual([
      `seed/${DATABASE_SEED_MEMBERS[0].id}/${DATABASE_SEED_MEMBERS[0].photoFilename}`,
    ]);
  });
});
