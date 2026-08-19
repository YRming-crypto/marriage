import { type ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";

type MotionEnhancerProps = {
  children: ReactNode;
};

export function MotionEnhancer({ children }: MotionEnhancerProps) {
  const location = useLocation();

  useEffect(() => {
    const revealElements = document.querySelectorAll<HTMLElement>("[data-reveal]");

    if (typeof window.IntersectionObserver !== "function") {
      revealElements.forEach((element) => element.classList.add("is-revealed"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    });

    revealElements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [location.key]);

  return children;
}
