import { parseAttendeeFile } from "./import-file";
import JSZip from "jszip";
import { drawCertificateText, drawDefaultBackground } from "./render";
import { FONTS, FONT_FILES, type InputRow, type Layout } from "./model";

type WorkerRequest = { action: "parse"; file: File } | { action: "zip"; layout: Layout; rows: InputRow[]; background?: Blob; rowOffset?: number };
const scope = self as unknown as { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage: (value: unknown) => void; fonts: FontFaceSet };
scope.onmessage = async ({ data }) => {
  try {
    if (data.action === "parse") { scope.postMessage({ type: "parsed", ...await parseAttendeeFile(data.file, progress => scope.postMessage({ type: "import-progress", ...progress })) }); return; }
    if (data.rows.length > 100) throw new Error("Local preview exports up to 100 rows. Sign in for background export of larger batches.");
    await Promise.all(FONTS.map(async (font, i) => { const face = new FontFace(font, `url(/certificate-fonts/${FONT_FILES[i]})`, { weight: "100 900" }); scope.fonts.add(await face.load()); }));
    const canvas = new OffscreenCanvas(data.layout.width, data.layout.height), ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser does not support background canvas exports");
    const background = data.background ? await createImageBitmap(data.background) : null;
    const zip = new JSZip(); let size = 0;
    for (const [i, row] of data.rows.entries()) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (background) ctx.drawImage(background, 0, 0, canvas.width, canvas.height); else drawDefaultBackground(ctx, canvas.width, canvas.height);
      drawCertificateText(ctx, data.layout, row);
      const png = await canvas.convertToBlob({ type: "image/png" }); size += png.size;
      if (size > 64 * 1024 * 1024) throw new Error("Preview export exceeds 64 MB. Use a smaller batch or the server export.");
      zip.file(`certificate-${(data.rowOffset || 0) + i + 1}.png`, await png.arrayBuffer());
      scope.postMessage({ type: "progress", completed: i + 1, total: data.rows.length });
    }
    background?.close();
    const bytes = await zip.generateAsync({ type: "arraybuffer", compression: "STORE" });
    scope.postMessage({ type: "zip", blob: new Blob([bytes], { type: "application/zip" }) });
  } catch (error) { scope.postMessage({ type: "error", message: error instanceof Error ? error.message : "Could not process this file" }); }
};
