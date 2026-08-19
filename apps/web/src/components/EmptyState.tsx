import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type IllustrationKind = "search" | "heart" | "message" | "calendar" | "star" | "shield" | "members" | "article" | "default";

interface EmptyStateProps {
  icon?: LucideIcon;
  kind?: IllustrationKind;
  title: string;
  description?: string;
  action?: ReactNode;
  role?: string;
}

function Illustration({ kind }: { kind: IllustrationKind }) {
  const palette = {
    stroke: "oklch(0.55 0.10 18)",
    fill: "oklch(0.94 0.04 18)",
    accent: "oklch(0.66 0.18 18)",
    warm: "oklch(0.90 0.06 40)",
  };

  const illustrations: Record<IllustrationKind, ReactNode> = {
    search: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <circle cx="54" cy="54" r="22" stroke={palette.stroke} strokeWidth="3" />
        <line x1="70" y1="70" x2="88" y2="88" stroke={palette.stroke} strokeWidth="3" strokeLinecap="round" />
        <circle cx="54" cy="54" r="8" fill={palette.warm} opacity="0.6" />
        <circle cx="46" cy="48" r="3" fill={palette.accent} opacity="0.4" />
      </svg>
    ),
    heart: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <path d="M60 88 C30 68 20 48 35 38 C45 30 55 36 60 44 C65 36 75 30 85 38 C100 48 90 68 60 88Z"
          fill={palette.warm} stroke={palette.stroke} strokeWidth="2.5" />
        <path d="M52 52 L56 48 L60 52 L68 44" stroke={palette.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      </svg>
    ),
    message: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <rect x="28" y="36" width="64" height="42" rx="10" fill={palette.warm} stroke={palette.stroke} strokeWidth="2.5" />
        <path d="M44 78 L38 92 L56 78" fill={palette.warm} stroke={palette.stroke} strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="42" y1="50" x2="78" y2="50" stroke={palette.stroke} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="42" y1="58" x2="68" y2="58" stroke={palette.stroke} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
        <line x1="42" y1="66" x2="56" y2="66" stroke={palette.stroke} strokeWidth="2" strokeLinecap="round" opacity="0.2" />
      </svg>
    ),
    calendar: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <rect x="30" y="34" width="60" height="56" rx="8" fill={palette.warm} stroke={palette.stroke} strokeWidth="2.5" />
        <line x1="30" y1="50" x2="90" y2="50" stroke={palette.stroke} strokeWidth="2.5" />
        <rect x="44" y="56" width="10" height="10" rx="2" fill={palette.accent} opacity="0.5" />
        <rect x="60" y="56" width="10" height="10" rx="2" fill={palette.stroke} opacity="0.2" />
        <rect x="44" y="70" width="10" height="10" rx="2" fill={palette.stroke} opacity="0.2" />
        <line x1="42" y1="28" x2="42" y2="40" stroke={palette.stroke} strokeWidth="2.5" strokeLinecap="round" />
        <line x1="78" y1="28" x2="78" y2="40" stroke={palette.stroke} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
    star: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <path d="M60 28 L68 48 L90 50 L74 64 L78 86 L60 76 L42 86 L46 64 L30 50 L52 48 Z"
          fill={palette.warm} stroke={palette.stroke} strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="60" cy="56" r="6" fill={palette.accent} opacity="0.4" />
      </svg>
    ),
    shield: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <path d="M60 26 L86 38 L86 62 C86 78 74 90 60 96 C46 90 34 78 34 62 L34 38 Z"
          fill={palette.warm} stroke={palette.stroke} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M50 60 L56 66 L72 50" stroke={palette.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    members: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <circle cx="48" cy="48" r="12" fill={palette.warm} stroke={palette.stroke} strokeWidth="2" />
        <path d="M28 82 C28 68 38 60 48 60 C58 60 68 68 68 82" fill={palette.warm} stroke={palette.stroke} strokeWidth="2" />
        <circle cx="76" cy="44" r="10" fill={palette.warm} stroke={palette.stroke} strokeWidth="2" opacity="0.7" />
        <path d="M62 78 C62 67 69 60 76 60 C83 60 90 67 90 78" fill={palette.warm} stroke={palette.stroke} strokeWidth="2" opacity="0.7" />
      </svg>
    ),
    article: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <rect x="32" y="30" width="56" height="60" rx="6" fill={palette.warm} stroke={palette.stroke} strokeWidth="2.5" />
        <line x1="42" y1="44" x2="78" y2="44" stroke={palette.stroke} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="42" y1="54" x2="72" y2="54" stroke={palette.stroke} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
        <line x1="42" y1="64" x2="66" y2="64" stroke={palette.stroke} strokeWidth="2" strokeLinecap="round" opacity="0.2" />
        <rect x="42" y="72" width="24" height="10" rx="3" fill={palette.accent} opacity="0.3" />
      </svg>
    ),
    default: (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="54" fill={palette.fill} />
        <circle cx="60" cy="52" r="16" fill={palette.warm} stroke={palette.stroke} strokeWidth="2" />
        <path d="M36 88 C36 72 46 64 60 64 C74 64 84 72 84 88" fill={palette.warm} stroke={palette.stroke} strokeWidth="2" />
        <circle cx="56" cy="50" r="2" fill={palette.stroke} opacity="0.5" />
        <circle cx="64" cy="50" r="2" fill={palette.stroke} opacity="0.5" />
        <path d="M55 58 Q60 62 65 58" stroke={palette.stroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
      </svg>
    ),
  };

  return <div className="empty-state__illustration">{illustrations[kind]}</div>;
}

export function EmptyState({ icon: Icon, kind = "default", title, description, action, role }: EmptyStateProps) {
  const defaultRole = action ? undefined : "status";
  return (
    <div className="empty-state-enhanced" role={role ?? defaultRole}>
      {Icon ? <div className="empty-state-enhanced__icon"><Icon /></div> : <Illustration kind={kind} />}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-enhanced__action">{action}</div> : null}
    </div>
  );
}
