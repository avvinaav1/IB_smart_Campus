"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  X,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  Maximize2,
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
  const [isZoomed, setIsZoomed] = useState(false);

  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const total = images.length;
  const currentImage = images[currentIndex] || "";

  const goPrev = useCallback(() => {
    setIsZoomed(false);
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  }, [total]);

  const goNext = useCallback(() => {
    setIsZoomed(false);
    setCurrentIndex((prev) => (prev + 1) % total);
  }, [total]);

  const toggleZoom = useCallback(() => {
    setIsZoomed((prev) => !prev);
  }, []);

  // Keyboard navigation & body scroll lock
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft" && total > 1) {
        goPrev();
      } else if (event.key === "ArrowRight" && total > 1) {
        goNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [goNext, goPrev, onClose, total]);

  // Touch handlers for mobile swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current !== null && touchEndX.current !== null && !isZoomed) {
      const diff = touchStartX.current - touchEndX.current;
      if (diff > 50 && total > 1) {
        goNext();
      } else if (diff < -50 && total > 1) {
        goPrev();
      }
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  if (!mounted || !currentImage) return null;

  const content = (
    <div
      className="image-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title || "Enlarged image view"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
        </div>

        <div className="image-lightbox-actions">
          <button
            type="button"
            className="image-lightbox-btn"
            onClick={toggleZoom}
            aria-label={isZoomed ? "Reset zoom" : "Zoom in"}
            title={isZoomed ? "Reset zoom (Click image)" : "Zoom in"}
          >
            {isZoomed ? <ZoomOut size={17} /> : <ZoomIn size={17} />}
            <span className="btn-label">{isZoomed ? "Fit" : "Zoom"}</span>
          </button>

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
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {total > 1 && (
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
          className={`image-lightbox-canvas ${isZoomed ? "is-zoomed" : ""}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              if (isZoomed) setIsZoomed(false);
              else onClose();
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentImage}
            alt={title ? `${title} - Attachment ${currentIndex + 1}` : `Image attachment ${currentIndex + 1}`}
            className={`image-lightbox-img ${isZoomed ? "is-zoomed" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleZoom();
            }}
            title={isZoomed ? "Click to fit image" : "Click to zoom in"}
          />
        </div>

        {total > 1 && (
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
                setIsZoomed(false);
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
