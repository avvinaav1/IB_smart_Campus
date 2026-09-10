"use client";
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Group, Shape, Rect, Image as CanvasImage } from "react-konva";
import type Konva from "konva";
import { effectiveElements, type InputRow, type Layout, type TextElement } from "@/lib/certificates/model";
import { drawText, drawDefaultBackground } from "@/lib/certificates/render";

export default function CertificateCanvas({ layout, row, selected, select, change, backgroundUrl, zoom, setZoom, addVariable }: {
  layout: Layout; row: InputRow; selected: string; select: (id: string) => void;
  change: (patch: Partial<TextElement>) => void; backgroundUrl: string; zoom: number; setZoom: (value: number) => void;
  addVariable: (name: string, x: number, y: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null), stage = useRef<Konva.Stage>(null);
  const [width, setWidth] = useState(700), [image, setImage] = useState<HTMLImageElement>();
  const [fontVersion, setFontVersion] = useState(0);
  const pinchDistance = useRef(0);
  useEffect(() => {
    const el = container.current; if (!el) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { let active = true; void document.fonts.ready.then(() => { if (active) setFontVersion(v => v + 1); }); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!backgroundUrl) return;
    let active = true; const img = new window.Image(); img.onload = () => { if (active) setImage(img); }; img.src = backgroundUrl;
    return () => { active = false; };
  }, [backgroundUrl]);
  const scale = Math.min(1, Math.max(0.1, (width - 40) / layout.width)) * zoom;
  const elements = effectiveElements(layout, row);
  return <div className="cert-canvas-viewport" ref={container} onDragOver={e => e.preventDefault()} onDrop={e => {
    e.preventDefault(); const name = e.dataTransfer.getData("text/certificate-column"); if (!name || !stage.current) return;
    const bounds = stage.current.container().getBoundingClientRect(); addVariable(name, (e.clientX - bounds.left) / scale, (e.clientY - bounds.top) / scale);
  }}>
    <div className="cert-canvas-scroll" onWheel={e => { if (e.ctrlKey || e.metaKey) setZoom(Math.min(3, Math.max(0.25, zoom * (e.deltaY > 0 ? 0.9 : 1.1)))); }}>
      <Stage ref={stage} width={layout.width * scale} height={layout.height * scale} scaleX={scale} scaleY={scale}
        onTouchMove={e => { const touches = e.evt.touches; if (touches.length === 2) { e.evt.preventDefault(); const distance = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); if (pinchDistance.current) setZoom(Math.min(3, Math.max(0.25, zoom * distance / pinchDistance.current))); pinchDistance.current = distance; } }}
        onTouchEnd={() => { pinchDistance.current = 0; }}>
        <Layer key={fontVersion}>
          {backgroundUrl && image ? <CanvasImage image={image} width={layout.width} height={layout.height} onClick={() => select("")} onTap={() => select("")} /> : <Shape sceneFunc={ctx => { drawDefaultBackground(ctx._context, layout.width, layout.height); }} listening={false} />}
          {elements.map(e => <Group key={e.id} x={e.x} y={e.y} rotation={e.rotation} draggable
            onClick={() => select(e.id)} onTap={() => select(e.id)} onDragStart={() => select(e.id)}
            onDragEnd={event => change({ id: e.id, x: Math.round(event.target.x()), y: Math.round(event.target.y()) })}>
            <Shape sceneFunc={ctx => drawText(ctx._context, { ...e, x: 0, y: 0, rotation: 0 })} listening={false} />
            <Rect width={e.width} height={e.height} fill="rgba(0,0,0,0)" stroke={e.id === selected ? "#6c3bff" : undefined} strokeWidth={2 / scale} dash={e.id === selected ? [8 / scale, 4 / scale] : undefined} />
            {e.id === selected && <Rect x={e.width - 8 / scale} y={e.height - 8 / scale} width={16 / scale} height={16 / scale} fill="#6c3bff" stroke="white" strokeWidth={2 / scale} draggable onDragStart={event => { event.cancelBubble = true; }} onDragEnd={event => { event.cancelBubble = true; change({ id: e.id, width: Math.max(20, Math.min(layout.width, event.target.x() + 8 / scale)), height: Math.max(20, Math.min(layout.height, event.target.y() + 8 / scale)) }); }} />}
          </Group>)}
        </Layer>
      </Stage>
    </div>
    <small className="cert-canvas-caption">{layout.width} × {layout.height} px · Drag layers to position · Pinch or use zoom controls</small>
  </div>;
}
