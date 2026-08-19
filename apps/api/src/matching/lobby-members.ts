import { createHmac } from "node:crypto";
import type { IncompleteLobbyMember } from "@ai-marriage/shared";
import type { Store, StoredProfile, StoredUser } from "../store/types.js";

export function incompleteLobbyMemberId(userId: string, secret: string) {
  const digest = createHmac("sha256", secret)
    .update(`lobby:${userId}`)
    .digest("base64url")
    .slice(0, 24);
  return `new-${digest}`;
}

export function incompleteLobbyMember(
  user: StoredUser,
  profile: StoredProfile | undefined,
  secret: string,
): IncompleteLobbyMember {
  if (!profile) {
    return {
      id: incompleteLobbyMemberId(user.id, secret),
      lobbyStatus: "new",
      nickname: "新加入会员",
      activeLabel: "资料待完善",
      joinedAt: user.createdAt,
      verified: false,
    };
  }

  return {
    id: incompleteLobbyMemberId(user.id, secret),
    lobbyStatus: "reviewing",
    nickname: profile.nickname,
    activeLabel: "资料审核中",
    joinedAt: user.createdAt,
    verified: false,
    gender: profile.gender as IncompleteLobbyMember["gender"],
    age: new Date().getFullYear() - profile.birthYear,
    city: profile.city,
    district: profile.district,
    job: profile.job,
    maritalStatus: profile.maritalStatus as IncompleteLobbyMember["maritalStatus"],
    goal: profile.goal as IncompleteLobbyMember["goal"],
  };
}

export function listIncompleteLobbyMembers(
  store: Store,
  secret: string,
  excludedUserIds: ReadonlySet<string> = new Set(),
) {
  const completeOwnerIds = new Set(
    [...store.members.values()].flatMap((member) => member.ownerUserId ? [member.ownerUserId] : []),
  );

  return [...store.users.values()]
    .filter((user) => user.role === "user" && user.status === "active")
    .filter((user) => !completeOwnerIds.has(user.id) && !excludedUserIds.has(user.id))
    .filter((user) => store.profiles.get(user.id)?.visibility !== "private")
    .map((user) => incompleteLobbyMember(user, store.profiles.get(user.id), secret));
}

export function findIncompleteLobbyOwner(store: Store, memberId: string, secret: string) {
  const completeOwnerIds = new Set(
    [...store.members.values()].flatMap((member) => member.ownerUserId ? [member.ownerUserId] : []),
  );
  return [...store.users.values()].find((user) => (
    user.role === "user"
    && user.status === "active"
    && !completeOwnerIds.has(user.id)
    && incompleteLobbyMemberId(user.id, secret) === memberId
  ));
}
