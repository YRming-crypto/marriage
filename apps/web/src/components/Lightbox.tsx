import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface LightboxProps {
  images: string[];
  initialIndex?: number;
  altPrefix?: string;
  onClose: () => void;
}

export function Lightbox({ images, initialIndex = 0, altPrefix = "照片", onClose }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const overlayRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const goTo = useCallback((index: number) => {
    if (index >= 0 && index < images.length) {
      setCurrentIndex(index);
    }
  }, [images.length]);

  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);
  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") goPrev();
      if (event.key === "ArrowRight") goNext();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose, goNext, goPrev]);

  function handleOverlayClick(event: React.MouseEvent) {
    if (event.target === overlayRef.current) onClose();
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? 0;
  }

  function handleTouchMove(event: React.TouchEvent) {
    touchEndX.current = event.touches[0]?.clientX ?? 0;
  }

  function handleTouchEnd() {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;
    if (diff > threshold) goNext();
    else if (diff < -threshold) goPrev();
  }

  const hasMultiple = images.length > 1;

  return (
    <div
      className="lightbox-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={`${altPrefix} ${currentIndex + 1} / ${images.length}`}
    >
      <div
        className="lightbox-content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <button className="lightbox-close" type="button" onClick={onClose} aria-label="关闭预览">
          <X size={20} />
        </button>

        {hasMultiple && currentIndex > 0 && (
          <button className="lightbox-nav lightbox-nav--prev" type="button" onClick={goPrev} aria-label="上一张">
            <ChevronLeft size={24} />
          </button>
        )}

        <img src={images[currentIndex]} alt={`${altPrefix} ${currentIndex + 1}`} />

        {hasMultiple && currentIndex < images.length - 1 && (
          <button className="lightbox-nav lightbox-nav--next" type="button" onClick={goNext} aria-label="下一张">
            <ChevronRight size={24} />
          </button>
        )}

        {hasMultiple && (
          <span className="lightbox-counter">{currentIndex + 1} / {images.length}</span>
        )}
      </div>
    </div>
  );
}
