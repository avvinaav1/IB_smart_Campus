import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { join } from "node:path";
import { drawCertificateText, drawDefaultBackground, type DrawingContext } from "./render";
import { FONTS, FONT_FILES, type Layout, type InputRow } from "./model";
let registered = false;
export async function renderPng(layout: Layout, row: InputRow & { verificationCode?: string }, background?: Uint8Array) {
  if (!registered) { FONTS.forEach((font, i) => { if (!GlobalFonts.registerFromPath(join(process.cwd(), "public", "certificate-fonts", FONT_FILES[i]), font)) throw new Error(`Missing font: ${font}`); }); registered = true; }
  const canvas = createCanvas(layout.width, layout.height), ctx = canvas.getContext("2d");
  if (background) ctx.drawImage(await loadImage(Buffer.from(background)), 0, 0, layout.width, layout.height);
  else drawDefaultBackground(ctx as unknown as DrawingContext, layout.width, layout.height);
  drawCertificateText(ctx as unknown as DrawingContext, layout, row);
  return canvas.encode("png");
}
