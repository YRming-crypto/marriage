import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cancelInterest, createInterest, getInterests } from "../../api/client";

interface MemberInterestContextValue {
  busyMemberIds: ReadonlySet<string>;
  likedMemberIds: ReadonlySet<string>;
  toggleInterest: (memberId: string) => Promise<boolean>;
}

const MemberInterestContext = createContext<MemberInterestContextValue | null>(null);

export function MemberInterestProvider({ children }: { children: ReactNode }) {
  const [likedMemberIds, setLikedMemberIds] = useState<Set<string>>(() => new Set());
  const [busyMemberIds, setBusyMemberIds] = useState<Set<string>>(() => new Set());
  const likedRef = useRef(likedMemberIds);
  const busyRef = useRef(busyMemberIds);
  const mutationVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const initialVersion = mutationVersion.current;
    void getInterests().then((result) => {
      if (!active || mutationVersion.current !== initialVersion) return;
      const restored = new Set(result.sent.map((interest) => interest.memberId));
      likedRef.current = restored;
      setLikedMemberIds(restored);
    }).catch(() => {
      // Public pages remain usable for signed-out visitors and during a relationship-service outage.
    });
    return () => { active = false; };
  }, []);

  async function toggleInterest(memberId: string) {
    if (busyRef.current.has(memberId)) return likedRef.current.has(memberId);
    const wasLiked = likedRef.current.has(memberId);
    const nextBusy = new Set(busyRef.current).add(memberId);
    busyRef.current = nextBusy;
    setBusyMemberIds(nextBusy);
    mutationVersion.current += 1;

    try {
      if (wasLiked) await cancelInterest(memberId);
      else await createInterest(memberId);
      const nextLiked = new Set(likedRef.current);
      if (wasLiked) nextLiked.delete(memberId);
      else nextLiked.add(memberId);
      likedRef.current = nextLiked;
      setLikedMemberIds(nextLiked);
      return !wasLiked;
    } finally {
      const remainingBusy = new Set(busyRef.current);
      remainingBusy.delete(memberId);
      busyRef.current = remainingBusy;
      setBusyMemberIds(remainingBusy);
    }
  }

  const value = useMemo<MemberInterestContextValue>(() => ({
    busyMemberIds,
    likedMemberIds,
    toggleInterest,
  }), [busyMemberIds, likedMemberIds]);

  return <MemberInterestContext.Provider value={value}>{children}</MemberInterestContext.Provider>;
}

export function useMemberInterest(memberId: string) {
  const context = useContext(MemberInterestContext);
  if (!context) throw new Error("MemberCard must be rendered inside MemberInterestProvider.");
  return {
    busy: context.busyMemberIds.has(memberId),
    liked: context.likedMemberIds.has(memberId),
    toggleInterest: context.toggleInterest,
  };
}
