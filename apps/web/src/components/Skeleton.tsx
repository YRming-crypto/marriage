import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
}

function Skeleton({ className = "", style, width, height, circle }: SkeletonProps) {
  const combinedStyle: CSSProperties = {
    ...style,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
  return (
    <span
      className={`skeleton ${circle ? "skeleton--circle" : ""} ${className}`}
      style={combinedStyle}
      aria-hidden="true"
    />
  );
}

export function SkeletonCard() {
  return (
    <article className="member-card skeleton-card" aria-hidden="true" data-reveal>
      <div className="member-card__media">
        <Skeleton className="skeleton-card__photo" />
      </div>
      <div className="member-card__body">
        <div className="member-card__meta">
          <Skeleton width={72} height={20} />
          <Skeleton width={56} height={20} />
        </div>
        <Skeleton className="skeleton-card__title" width="60%" height={24} />
        <Skeleton width="45%" height={18} />
        <Skeleton width="70%" height={18} />
        <div className="skeleton-card__tags">
          <Skeleton width={52} height={26} />
          <Skeleton width={64} height={26} />
          <Skeleton width={48} height={26} />
        </div>
        <div className="member-card__actions">
          <Skeleton className="skeleton-card__button" height={44} />
          <Skeleton circle width={44} height={44} />
        </div>
      </div>
    </article>
  );
}

interface SkeletonGridProps {
  count?: number;
}

export function SkeletonGrid({ count = 6 }: SkeletonGridProps) {
  return (
    <div className="member-grid member-grid--results" aria-label="正在加载会员资料">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-list" aria-label="正在加载" role="status">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-list__item" key={index}>
          <Skeleton circle width={48} height={48} />
          <div className="skeleton-list__content">
            <Skeleton width="40%" height={18} />
            <Skeleton width="70%" height={16} />
          </div>
          <Skeleton width={56} height={28} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonHero() {
  return (
    <section className="home-hero" aria-label="正在加载">
      <Skeleton className="skeleton-hero__image" />
      <div className="shell skeleton-hero__content">
        <Skeleton width={240} height={16} />
        <Skeleton width={320} height={48} />
        <Skeleton width={400} height={20} />
        <div className="skeleton-hero__actions">
          <Skeleton width={180} height={52} />
          <Skeleton width={120} height={52} />
        </div>
      </div>
    </section>
  );
}
