"use client";

import Image from "next/image";
import { Crop, ImagePlus, Maximize2 } from "lucide-react";
import { useRef } from "react";
import type { CoverFit } from "@/lib/types";

export const EVENT_DEFAULT_COVERS: Record<string, string> = {
  Music: "/indie-night.svg",
  Tech: "/build-weird.svg",
  Culture: "/thrift-market.svg",
  Sports: "/run-club.svg",
  Other: "/campus-rain.svg",
};

export function defaultCoverFor(category: string) {
  return EVENT_DEFAULT_COVERS[category] || EVENT_DEFAULT_COVERS.Other;
}

export function EventCoverField({
  category, imageUrl, previewUrl, fit, focusX, focusY,
  onPickFile, onFitChange, onFocusChange,
}: {
  category: string;
  imageUrl: string;
  previewUrl: string;
  fit: CoverFit;
  focusX: number;
  focusY: number;
  onPickFile: (file: File) => void;
  onFitChange: (fit: CoverFit) => void;
  onFocusChange: (x: number, y: number) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const src = previewUrl || imageUrl || defaultCoverFor(category);
  const isRemote = src.startsWith("/api/") || src.startsWith("blob:");
  const canFocus = fit === "fill";

  function moveFocus(clientX: number, clientY: number) {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.min(100, Math.max(0, Math.round(((clientX - box.left) / box.width) * 100)));
    const y = Math.min(100, Math.max(0, Math.round(((clientY - box.top) / box.height) * 100)));
    onFocusChange(x, y);
  }

  return (
    <div className="event-cover-field">
      <div
        ref={frame}
        className={`event-cover-preview ${fit === "fit" ? "is-fit" : "is-fill"} ${canFocus ? "focusable" : ""}`}
        onPointerDown={(event) => {
          if (!canFocus) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          moveFocus(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => { if (dragging.current) moveFocus(event.clientX, event.clientY); }}
        onPointerUp={(event) => { dragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        <Image
          src={src}
          alt="Event cover preview"
          fill
          sizes="640px"
          unoptimized={isRemote || Boolean(previewUrl)}
          style={{ objectFit: fit === "fit" ? "contain" : "cover", objectPosition: `${focusX}% ${focusY}%` }}
        />
        {canFocus && <span className="event-cover-focus" style={{ left: `${focusX}%`, top: `${focusY}%` }} aria-hidden="true" />}
        <span className="event-cover-tag">{category}</span>
        <input
          ref={fileInput}
          className="file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) onPickFile(file); event.target.value = ""; }}
        />
        <button type="button" className="event-cover-upload" onClick={() => fileInput.current?.click()}>
          <ImagePlus size={16} /> {imageUrl || previewUrl ? "Change cover" : "Upload cover"}
        </button>
      </div>
      <div className="event-cover-controls">
        <div className="event-cover-fit" role="radiogroup" aria-label="Cover image fit">
          <button type="button" role="radio" aria-checked={fit === "fill"} className={fit === "fill" ? "active" : ""} onClick={() => onFitChange("fill")}>
            <Crop size={14} /> Fill &amp; crop
          </button>
          <button type="button" role="radio" aria-checked={fit === "fit"} className={fit === "fit" ? "active" : ""} onClick={() => onFitChange("fit")}>
            <Maximize2 size={14} /> Fit whole image
          </button>
        </div>
        <small>{fit === "fill" ? "Drag the cover to choose which part stays in frame." : "The whole image is shown; edges are padded to fit the layout."}</small>
      </div>
    </div>
  );
}
