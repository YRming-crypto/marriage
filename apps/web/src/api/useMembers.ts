import type { LobbyMember, Member, MembersQuery } from "@ai-marriage/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getMembers } from "./client";

function hasCompleteMemberShape(value: unknown): value is Member {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Member>;
  return typeof candidate.id === "string"
    && typeof candidate.nickname === "string"
    && typeof candidate.gender === "string"
    && typeof candidate.age === "number"
    && typeof candidate.city === "string"
    && typeof candidate.district === "string"
    && typeof candidate.job === "string"
    && typeof candidate.maritalStatus === "string"
    && typeof candidate.goal === "string"
    && Array.isArray(candidate.tags)
    && typeof candidate.introduction === "string"
    && typeof candidate.photoUrl === "string"
    && typeof candidate.activeLabel === "string"
    && typeof candidate.verified === "boolean";
}

export function isVerifiedLobbyMember(member: LobbyMember | Member): member is Member & { lobbyStatus?: "verified" } {
  if (hasCompleteMemberShape(member)) return true;
  if (typeof member !== "object" || member === null) return false;

  const raw = member as unknown as Record<string, unknown>;
  return raw.lobbyStatus === "verified" && hasCompleteMemberShape(raw);
}

export function normalizeLobbyMembers(items: Array<LobbyMember | Member>): Member[] {
  return items.filter(isVerifiedLobbyMember);
}

export function useMembers(filters: MembersQuery | string = {}) {
  const queryKey = JSON.stringify(typeof filters === "string" ? { city: filters } : filters);
  const query = useMemo(() => JSON.parse(queryKey) as MembersQuery, [queryKey]);
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const requestVersion = useRef(0);
  const loadMoreRequestSequence = useRef(0);
  const activeLoadMoreRequest = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    activeLoadMoreRequest.current = null;
    setLoadingMore(false);
    setStatus("loading");
    setError("");
    const version = ++requestVersion.current;
    getMembers(query)
      .then((result) => {
        if (!active || version !== requestVersion.current) return;
        const verifiedMembers = normalizeLobbyMembers(result.items);
        setMembers(verifiedMembers);
        setTotal(result.total);
        setNextCursor(result.nextCursor ?? null);
        setHasMore(result.hasMore ?? verifiedMembers.length < result.total);
        setStatus("success");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setMembers([]); setTotal(0); setNextCursor(null); setHasMore(false);
        setStatus("error");
        setError(cause instanceof Error ? cause.message : "会员资料暂时无法加载，请稍后重试。");
      });
    return () => {
      active = false;
      if (version === requestVersion.current) requestVersion.current += 1;
      activeLoadMoreRequest.current = null;
    };
  }, [query, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || activeLoadMoreRequest.current !== null) return;
    const version = requestVersion.current;
    const requestId = ++loadMoreRequestSequence.current;
    activeLoadMoreRequest.current = requestId;
    setLoadingMore(true);
    setError("");
    try {
      const result = await getMembers({ ...query, cursor: nextCursor });
      if (version !== requestVersion.current || activeLoadMoreRequest.current !== requestId) return;
      const nextMembers = normalizeLobbyMembers(result.items);
      setMembers((current) => {
        const existing = new Set(current.map((member) => member.id));
        return [...current, ...nextMembers.filter((member) => !existing.has(member.id))];
      });
      setTotal(result.total);
      setNextCursor(result.nextCursor ?? null);
      setHasMore(result.hasMore ?? false);
    } catch (cause) {
      if (version !== requestVersion.current || activeLoadMoreRequest.current !== requestId) return;
      if (cause instanceof ApiError && cause.code === "INVALID_CURSOR") {
        setNextCursor(null);
        setHasMore(false);
        try {
          const refreshed = await getMembers(query);
          if (version !== requestVersion.current || activeLoadMoreRequest.current !== requestId) return;
          const refreshedMembers = normalizeLobbyMembers(refreshed.items);
          setMembers(refreshedMembers);
          setTotal(refreshed.total);
          setNextCursor(refreshed.nextCursor ?? null);
          setHasMore(refreshed.hasMore ?? refreshedMembers.length < refreshed.total);
          setStatus("success");
          setError("");
        } catch (refreshCause) {
          if (version !== requestVersion.current || activeLoadMoreRequest.current !== requestId) return;
          setError(refreshCause instanceof Error ? refreshCause.message : "会员列表刷新失败，请稍后重试。");
        }
        return;
      }
      setError(cause instanceof Error ? cause.message : "更多会员暂时无法加载，请稍后重试。");
    } finally {
      if (activeLoadMoreRequest.current === requestId) {
        activeLoadMoreRequest.current = null;
        if (version === requestVersion.current) setLoadingMore(false);
      }
    }
  }, [hasMore, nextCursor, query]);

  return { members, total, hasMore, loadingMore, status, error, loadMore, retry: () => setReloadKey((current) => current + 1) };
}
