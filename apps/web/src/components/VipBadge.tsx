import { Crown } from "lucide-react";

export function VipBadge({ tier, size = "small" }: { tier: string; size?: "small" | "medium" | "large" }) {
  if (tier === "free") return null;

  const sizeClass = size === "large" ? "vip-badge--large" : size === "medium" ? "vip-badge--medium" : "";

  return (
    <span className={`vip-badge ${sizeClass}`} title="VIP 会员">
      <Crown aria-hidden="true" />
      <span>VIP</span>
    </span>
  );
}
