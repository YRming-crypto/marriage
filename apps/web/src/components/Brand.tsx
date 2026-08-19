import { HeartHandshake } from "lucide-react";
import { Link } from "react-router-dom";

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="缘来相伴首页">
      <span className="brand__mark" aria-hidden="true">
        <HeartHandshake size={27} strokeWidth={2.2} />
      </span>
      <span>
        <strong>缘来相伴</strong>
        <small>认真认识，安心交往</small>
      </span>
    </Link>
  );
}
