import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  actionTo?: string;
  aside?: ReactNode;
}

export function SectionHeading({ eyebrow, title, description, actionLabel, actionTo, aside }: SectionHeadingProps) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <span className="section-heading__eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {aside ?? (actionLabel && actionTo ? (
        <Link className="inline-link" to={actionTo}>
          {actionLabel}<ArrowRight size={19} />
        </Link>
      ) : null)}
    </div>
  );
}
