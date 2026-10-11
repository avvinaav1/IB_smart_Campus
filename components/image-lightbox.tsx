"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  X,
  ExternalLink,
} from "lucide-react";

export interface ImageLightboxProps {
  images: string[];
  initialIndex?: number;
  title?: string;
  subtitle?: string;
  onClose: () => void;
}

export function ImageLightbox({
  images,
  initialIndex = 0,
  title,
  subtitle,
  onClose,
}: ImageLightboxProps) {
  const [mounted, setMounted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(0, Math.min(initialIndex, images.length - 1))
  );

  // Dynamic zoom (1x to 4x) & panning coordinates
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Mouse drag tracking
  const isMouseDownRef = useRef(false);
  const dragStartMouseRef = useRef({ x: 0, y: 0 });
  const dragStartPosRef = useRef({ x: 0, y: 0 });

  // Touch tracking (pinch & pan & swipe)
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartScaleRef = useRef(1);
  const touchStartPosRef = useRef({ x: 0, y: 0 });
  const touchStartCoordsRef = useRef({ x: 0, y: 0 });
  const lastTouchTimeRef = useRef(0);
  const hasMovedSignificantlyRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const total = images.length;
  const currentImage = images[currentIndex] || "";

  const resetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const goPrev = useCallback(() => {
    resetZoom();
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  }, [resetZoom, total]);

  const goNext = useCallback(() => {
    resetZoom();
    setCurrentIndex((prev) => (prev + 1) % total);
  }, [resetZoom, total]);

  const clampPosition = useCallback((x: number, y: number, currentScale: number) => {
    if (currentScale <= 1) return { x: 0, y: 0 };
    const maxPanX = (window.innerWidth * (currentScale - 1)) / 2 + 60;
    const maxPanY = (window.innerHeight * (currentScale - 1)) / 2 + 60;
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, y)),
    };
  }, []);

  // Keyboard navigation & body scroll lock
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft" && total > 1 && scale === 1) {
        goPrev();
      } else if (event.key === "ArrowRight" && total > 1 && scale === 1) {
        goNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [goNext, goPrev, onClose, total, scale]);

  // Mouse wheel zoom (natural scroll in/out)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.18 : 0.84;
    setScale((prevScale) => {
      const nextScale = Math.min(4, Math.max(1, Number((prevScale * factor).toFixed(2))));
      if (nextScale <= 1.02) {
        setPosition({ x: 0, y: 0 });
        return 1;
      }
      const ratio = nextScale / prevScale;
      setPosition((prevPos) => clampPosition(prevPos.x * ratio, prevPos.y * ratio, nextScale));
      return nextScale;
    });
  };

  // Double click / tap toggle between 1x and 2.5x
  const handleToggleZoom = useCallback(() => {
    setScale((prev) => {
      if (prev > 1) {
        setPosition({ x: 0, y: 0 });
        return 1;
      }
      return 2.5;
    });
  }, []);

  // Mouse down on canvas or image for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1 || e.button !== 0) return;
    e.preventDefault();
    isMouseDownRef.current = true;
    setIsInteracting(true);
    setIsDragging(true);
    dragStartMouseRef.current = { x: e.clientX, y: e.clientY };
    dragStartPosRef.current = { ...position };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDownRef.current || scale <= 1) return;
    e.preventDefault();
    const dx = e.clientX - dragStartMouseRef.current.x;
    const dy = e.clientY - dragStartMouseRef.current.y;
    setPosition(clampPosition(dragStartPosRef.current.x + dx, dragStartPosRef.current.y + dy, scale));
  };

  const handleMouseUp = () => {
    if (isMouseDownRef.current) {
      isMouseDownRef.current = false;
      setIsInteracting(false);
      setIsDragging(false);
    }
  };

  // Touch handlers for pinch-to-zoom (2 fingers) and pan / swipe (1 finger)
  const handleTouchStart = (e: React.TouchEvent) => {
    hasMovedSignificantlyRef.current = false;
    if (e.touches.length === 2) {
      // Pinch to zoom started
      setIsInteracting(true);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      touchStartScaleRef.current = scale;
      touchStartPosRef.current = { ...position };
    } else if (e.touches.length === 1) {
      // 1 finger: pan if zoomed, or track swipe / double tap if not zoomed
      const now = Date.now();
      if (now - lastTouchTimeRef.current < 300) {
        // Double tap detected!
        e.preventDefault();
        handleToggleZoom();
        lastTouchTimeRef.current = 0;
        return;
      }
      lastTouchTimeRef.current = now;

      touchStartCoordsRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      dragStartPosRef.current = { ...position };
      if (scale > 1) {
        setIsInteracting(true);
        setIsDragging(true);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      // Pinching
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / touchStartDistRef.current;
      const nextScale = Math.min(4, Math.max(1, Number((touchStartScaleRef.current * ratio).toFixed(2))));
      setScale(nextScale);
      if (nextScale <= 1.02) {
        setPosition({ x: 0, y: 0 });
      } else {
        const posRatio = nextScale / touchStartScaleRef.current;
        setPosition(clampPosition(touchStartPosRef.current.x * posRatio, touchStartPosRef.current.y * posRatio, nextScale));
      }
    } else if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartCoordsRef.current.x;
      const dy = e.touches[0].clientY - touchStartCoordsRef.current.y;
      if (Math.hypot(dx, dy) > 10) {
        hasMovedSignificantlyRef.current = true;
      }
      if (scale > 1) {
        // Pan the zoomed image
        e.preventDefault();
        setPosition(clampPosition(dragStartPosRef.current.x + dx, dragStartPosRef.current.y + dy, scale));
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    touchStartDistRef.current = null;
    setIsInteracting(false);
    setIsDragging(false);

    if (scale <= 1.05) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }

    // 1-finger horizontal swipe between images when scale is 1
    if (scale === 1 && e.changedTouches.length === 1 && !e.touches.length) {
      const dx = touchStartCoordsRef.current.x - e.changedTouches[0].clientX;
      const dy = Math.abs(touchStartCoordsRef.current.y - e.changedTouches[0].clientY);
      if (Math.abs(dx) > 50 && dy < 80 && total > 1) {
        if (dx > 0) goNext();
        else goPrev();
      }
    }
  };

  if (!mounted || !currentImage) return null;

  const content = (
    <div
      className="image-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title || "Enlarged image view"}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (scale > 1) resetZoom();
          else onClose();
        }
      }}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Header bar */}
      <header className="image-lightbox-header">
        <div className="image-lightbox-info">
          {title && <b title={title}>{title}</b>}
          {subtitle && <small>{subtitle}</small>}
          {total > 1 && (
            <span className="image-lightbox-counter">
              {currentIndex + 1} / {total}
            </span>
          )}
          {scale > 1 && (
            <button
              type="button"
              className="image-lightbox-counter zoom-reset-badge"
              onClick={resetZoom}
              title="Click to reset zoom"
              style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,0.3)" }}
            >
              {Math.round(scale * 100)}% · Reset
            </button>
          )}
        </div>

        <div className="image-lightbox-actions">
          <a
            href={currentImage}
            target="_blank"
            rel="noopener noreferrer"
            className="image-lightbox-btn"
            aria-label="Open original image in new tab"
            title="Open original image in new tab"
          >
            <ExternalLink size={17} />
            <span className="btn-label">Original</span>
          </a>

          <button
            type="button"
            className="image-lightbox-btn close"
            onClick={onClose}
            aria-label="Close full-screen image (Esc)"
            title="Close (Esc)"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Main image viewer stage */}
      <main
        className="image-lightbox-main"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            if (scale > 1) resetZoom();
            else onClose();
          }
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {total > 1 && scale === 1 && (
          <button
            type="button"
            className="image-lightbox-nav image-lightbox-prev"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label="Previous image (Left arrow)"
            title="Previous image"
          >
            <ChevronLeft size={28} />
          </button>
        )}

        <div
          className="image-lightbox-canvas"
          style={{ overflow: "hidden", touchAction: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentImage}
            alt={title ? `${title} - Attachment ${currentIndex + 1}` : `Image attachment ${currentIndex + 1}`}
            className="image-lightbox-img"
            style={{
              transform: `translate3d(${position.x}px, ${position.y}px, 0px) scale(${scale})`,
              transformOrigin: "center center",
              transition: isInteracting ? "none" : "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
              cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in",
              touchAction: "none",
              userSelect: "none",
            }}
            draggable={false}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleToggleZoom();
            }}
            title={scale > 1 ? "Drag to pan, wheel or double-click to reset" : "Scroll wheel or double-click to zoom"}
          />
        </div>

        {total > 1 && scale === 1 && (
          <button
            type="button"
            className="image-lightbox-nav image-lightbox-next"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label="Next image (Right arrow)"
            title="Next image"
          >
            <ChevronRight size={28} />
          </button>
        )}
      </main>

      {/* Thumbnails strip for multi-image galleries */}
      {total > 1 && (
        <footer className="image-lightbox-thumbs" role="tablist" aria-label="Gallery thumbnails">
          {images.map((img, idx) => (
            <button
              key={`${img}-${idx}`}
              type="button"
              role="tab"
              aria-selected={idx === currentIndex}
              className={`image-lightbox-thumb ${idx === currentIndex ? "is-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                resetZoom();
                setCurrentIndex(idx);
              }}
              aria-label={`View image ${idx + 1} of ${total}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt={`Thumbnail ${idx + 1}`} />
            </button>
          ))}
        </footer>
      )}
    </div>
  );

  return createPortal(content, document.body);
}
