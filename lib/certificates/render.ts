import { effectiveElements, type Layout, type InputRow, type TextElement } from "./model";

export type DrawingContext = Pick<CanvasRenderingContext2D, "save" | "restore" | "translate" | "rotate" | "beginPath" | "rect" | "clip" | "fillText" | "measureText" | "fillRect" | "strokeRect" | "font" | "fillStyle" | "strokeStyle" | "lineWidth" | "textBaseline" | "textAlign" | "shadowColor" | "shadowBlur" | "shadowOffsetX" | "shadowOffsetY">;
export function drawText(ctx: DrawingContext, e: TextElement) {
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.rotation * Math.PI / 180);
  ctx.beginPath(); ctx.rect(0, 0, e.width, e.height); ctx.clip();
  ctx.font = `${e.italic ? "italic " : ""}${e.bold ? "bold " : ""}${e.fontSize}px "${e.fontFamily}"`;
  ctx.fillStyle = e.color; ctx.textBaseline = "top"; ctx.textAlign = e.align;
  if (e.shadow.enabled) {
    ctx.shadowColor = `${e.shadow.color}${Math.round(e.shadow.opacity * 255).toString(16).padStart(2, "0")}`;
    ctx.shadowBlur = e.shadow.blur; ctx.shadowOffsetX = e.shadow.offsetX; ctx.shadowOffsetY = e.shadow.offsetY;
  }
  const lines: string[] = [];
  for (const paragraph of e.text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > e.width) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  const x = e.align === "center" ? e.width / 2 : e.align === "right" ? e.width : 0;
  lines.forEach((line, i) => ctx.fillText(line, x, i * e.fontSize * e.lineHeight));
  ctx.restore();
}
export function drawDefaultBackground(ctx: DrawingContext, width: number, height: number) {
  ctx.fillStyle = "#fffdf8"; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#bda775"; ctx.lineWidth = 2; ctx.strokeRect(30, 30, width - 60, height - 60);
  ctx.strokeStyle = "#e8dfcd"; ctx.lineWidth = 1; ctx.strokeRect(42, 42, width - 84, height - 84);
}
export function drawCertificateText(ctx: DrawingContext, layout: Layout, row: InputRow) { effectiveElements(layout, row).forEach(e => drawText(ctx, e)); }
