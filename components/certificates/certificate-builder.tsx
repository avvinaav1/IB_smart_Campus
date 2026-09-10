"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Award, Upload, Download, Mail, Plus, Trash2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Layers, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { FONTS, FONT_FILES, INITIAL_LAYOUT, MAX_ROWS, effectiveElements, jobInputSchema, layoutSchema, newElement, substitute, variables, type InputRow, type JobInput, type Layout, type TextElement } from "@/lib/certificates/model";
import { replaceVariable, resolveColumn } from "@/lib/certificates/columns";
import { isVerificationVariable, VERIFICATION_VARIABLE } from "@/lib/certificates/verification-code";
import { certificateRequest, downloadBlob, jsonRequest, uploadCertificateAsset } from "./client";
import type { CampusEvent } from "@/lib/types";

const CertificateCanvas = dynamic(() => import("./certificate-canvas"), { ssr: false, loading: () => <div className="cert-empty">Loading editor…</div> });
const DEMO_ROWS: InputRow[] = [{ values: { name: "Alex Morgan", email: "alex@example.test", course: "Campus Leadership" }, overrides: {} }, { values: { name: "Sam Rivera", email: "sam@example.test", course: "Campus Leadership" }, overrides: {} }];
type JobStatus = { id: string; title: string; status: string; totalRows: number; processedRows: number; failedRows: number; archiveStatus: string; lastError?: string };
type RowStatus = { id: string; rowNumber: number; matchStatus: string; renderStatus: string; emailStatus: string; internalStatus: string; lastError?: string; imageUrl?: string };
export default function CertificateBuilder({ preview = false, events = [] }: { preview?: boolean; events?: CampusEvent[] }) {
  const [layout, setLayout] = useState<Layout>(INITIAL_LAYOUT), [rows, setRows] = useState<InputRow[]>(DEMO_ROWS), [headers, setHeaders] = useState(["name", "email", "course"]);
  const [title, setTitle] = useState("Campus Leadership Certificate"), [eventId, setEventId] = useState("");
  const [background, setBackground] = useState<Blob>(), [backgroundUrl, setBackgroundUrl] = useState("");
  const [selected, setSelected] = useState("text-2"), [rowIndex, setRowIndex] = useState(0), [rowOnly, setRowOnly] = useState(false), [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<"design" | "delivery" | "history">("design");
  const [workerBusy, setWorkerBusy] = useState(false), [fontsReady, setFontsReady] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [mapping, setMapping] = useState({ email: "email", username: "", displayName: "name" });
  const [importName, setImportName] = useState("Sample attendees"), [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [batchStart, setBatchStart] = useState(1), [batchEnd, setBatchEnd] = useState(DEMO_ROWS.length);
  const batchLimit = preview ? 100 : MAX_ROWS, batchCount = batchEnd - batchStart + 1;
  function selectBatch(start: number, end = Math.min(rows.length, start + batchLimit - 1)) {
    setBatchStart(start); setBatchEnd(end); setRowIndex(start - 1); setMatches([]);
  }
  const [emailSubject, setEmailSubject] = useState("Your {{course}} certificate"), [emailBody, setEmailBody] = useState("Hi {{name}},\n\nThank you for participating in {{course}}. Your certificate is attached.\n\nSee you on campus!");
  const [internal, setInternal] = useState(true), [sendEmail, setSendEmail] = useState(true), [distinctAwards, setDistinctAwards] = useState(false);
  const [matches, setMatches] = useState<{ rowNumber: number; status: string; reason: string }[]>([]);
  const [history, setHistory] = useState<JobStatus[]>([]), [jobId, setJobId] = useState(""), [job, setJob] = useState<JobStatus>();
  const [jobRows, setJobRows] = useState<RowStatus[]>([]), [rowCursor, setRowCursor] = useState<string | null>(null), [retryUnknown, setRetryUnknown] = useState(false);
  const worker = useRef<Worker | null>(null), asset = useRef<{ blob: Blob; id: string } | null>(null);
  const designInput = useRef<HTMLInputElement>(null);
  const requestKey = useRef<{ digest: string; key: string } | null>(null);
  useEffect(() => {
    void Promise.all(FONTS.map(async (font, i) => { const face = new FontFace(font, `url(/certificate-fonts/${FONT_FILES[i]})`, { weight: "100 900" }); document.fonts.add(await face.load()); })).then(() => setFontsReady(true)).catch(() => setError("Certificate fonts could not load. Refresh before exporting."));
    return () => worker.current?.terminate();
  }, []);
  useEffect(() => { if (!background) return; const url = URL.createObjectURL(background); const frame = requestAnimationFrame(() => setBackgroundUrl(url)); return () => { cancelAnimationFrame(frame); URL.revokeObjectURL(url); }; }, [background]);
  useEffect(() => {
    if (preview || tab !== "history") return;
    let active = true, first = true;
    const refresh = async () => {
      try {
        const data = await certificateRequest<{ jobs: JobStatus[] }>("/jobs"); if (active) setHistory(data.jobs);
        if (jobId) {
          const detail = await certificateRequest<{ job: JobStatus; rows: RowStatus[]; nextCursor: string | null }>(`/jobs/${jobId}`);
          if (active) { setJob(detail.job); setJobRows(current => current.length > 50 ? [...detail.rows, ...current.slice(50)] : detail.rows); if (first) { setRowCursor(detail.nextCursor); first = false; } }
        }
      } catch (e) { if (active) setError((e as Error).message); }
    };
    void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [preview, tab, jobId]);
  const row = rows[rowIndex] || { values: {}, overrides: {} }, activeElement = effectiveElements(layout, row).find(e => e.id === selected);
  const editableElement = layout.elements.find(e => e.id === selected);
  const currentText = row.overrides[selected]?.text ?? editableElement?.text ?? "";
  const certificateFields = useMemo(() => [...new Set([...layout.elements.flatMap(e => variables(e.text)), ...rows.flatMap(r => Object.values(r.overrides).flatMap(o => variables(o.text || "")))])].filter(field => !isVerificationVariable(field)), [layout, rows]);
  const unmappedFields = certificateFields.filter(field => !resolveColumn(field, headers));
  function connectField(field: string, column: string) {
    if (!column) return;
    const replace = (text: string) => replaceVariable(text, field, column);
    setLayout(current => ({ ...current, elements: current.elements.map(e => ({ ...e, text: replace(e.text) })) }));
    setRows(current => current.map(r => ({ ...r, overrides: Object.fromEntries(Object.entries(r.overrides).map(([id, override]) => [id, override.text === undefined ? override : { ...override, text: replace(override.text) }])) })));
    setEmailSubject(replace); setEmailBody(replace); setError("");
  }
  function change(patch: Partial<TextElement>) {
    const id = patch.id || selected; if (!id) return;
    const { id: unused, ...fields } = patch; void unused;
    if (rowOnly) setRows(current => current.map((r, i) => i === rowIndex ? { ...r, overrides: { ...r.overrides, [id]: { ...r.overrides[id], ...fields } } } : r));
    else setLayout(current => ({ ...current, elements: current.elements.map(e => e.id === id ? { ...e, ...fields } : e) }));
  }
  function addVariable(name: string, x = 100, y = 350) {
    if (layout.elements.length >= 50) return setError("A template can contain at most 50 layers.");
    const element = { ...newElement(name ? `{{${name}}}` : "Your text", layout.elements.length), id: crypto.randomUUID(), x: Math.round(Math.max(0, Math.min(layout.width - 100, x))), y: Math.round(Math.max(0, Math.min(layout.height - 50, y))) };
    setLayout(current => ({ ...current, elements: [...current.elements, element] })); setSelected(element.id); setRowOnly(false);
  }
  function runWorker(action: Record<string, unknown>) {
    worker.current?.terminate(); setWorkerBusy(true); setBusy(true); setError(""); setNotice(action.action === "parse" ? "Reading attendees…" : "Generating certificate images…");
    const task = new Worker(new URL("../../lib/certificates/browser-worker.ts", import.meta.url)); worker.current = task;
    task.onerror = () => { setError("Background processing failed. Try a smaller file or refresh the editor."); setBusy(false); setWorkerBusy(false); setNotice(""); task.terminate(); };
    task.onmessage = ({ data }) => {
      if (data.type === "import-progress") { setNotice(`Reading attendees: ${data.percent}% · ${data.rowsRead.toLocaleString()} rows read…`); return; }
      if (data.type === "progress") { setNotice(`Generated ${data.completed} of ${data.total} certificates…`); return; }
      if (data.type === "parsed") {
        setHeaders(data.headers); setRows(data.rows); setRowIndex(0); setMatches([]);
        setBatchStart(1); setBatchEnd(Math.min(data.rows.length, batchLimit));
        setMapping({ email: resolveColumn("email", data.headers) || "", username: resolveColumn("username", data.headers) || "", displayName: resolveColumn("name", data.headers) || "" });
        setImportName(data.fileName); setImportWarnings(data.warnings || []);
        setNotice(`${data.rows.length} attendees imported from ${data.fileName}. Preview each row below the certificate.`);
      } else if (data.type === "zip") { downloadBlob(data.blob, `certificates-rows-${batchStart}-${batchEnd}.zip`); setNotice(`ZIP downloaded for rows ${batchStart}–${batchEnd}. ${batchEnd < rows.length ? "Choose the next batch to continue." : "Your selected certificates are ready."}`); }
      else { setError(`${data.message}${action.action === "parse" ? " Your previous attendees are still loaded; this file was not imported." : ""}`); setNotice(""); }
      setBusy(false); setWorkerBusy(false); task.terminate(); worker.current = null;
    };
    task.postMessage(action);
  }
  async function setBackgroundFile(file?: File) {
    if (!file) return;
    if (!/image\/(png|jpeg|webp)/.test(file.type) || file.size > 8 * 1024 * 1024) return setError("Choose a PNG, JPG or WebP background up to 8 MB.");
    try { const bitmap = await createImageBitmap(file); if (bitmap.width * bitmap.height > 8_000_000 || bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width < 320 || bitmap.height < 240) throw new Error("Background dimensions must be 320×240 to 4096×4096, up to 8 megapixels."); setLayout(current => ({ ...current, width: bitmap.width, height: bitmap.height })); bitmap.close(); setBackground(file); asset.current = null; setError(""); }
    catch (e) { setError((e as Error).message || "Could not open the image."); }
  }
  function inputFor(actions: JobInput["requestedActions"]): JobInput {
    if (!Number.isInteger(batchStart) || !Number.isInteger(batchEnd) || batchStart < 1 || batchEnd > rows.length || batchCount < 1 || batchCount > batchLimit) throw new Error(`Choose between 1 and ${batchLimit} rows for this batch.`);
    const input = jobInputSchema.parse({ title, layout, rows: rows.slice(batchStart - 1, batchEnd), headers, columnMapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), requestedActions: actions, emailTemplate: { subject: emailSubject, text: emailBody }, allowDistinctAwards: distinctAwards, ...(eventId ? { eventId } : {}) });
    if (!preview && new Blob([JSON.stringify(input)]).size > 6 * 1024 * 1024 - 1024) throw new Error("This batch contains more than 6 MB of data. Select a smaller row range.");
    return input;
  }
  function errorMessage(e: unknown) { const value = e as { issues?: { message: string }[]; message?: string }; return value.issues?.[0]?.message || value.message || "Could not complete the request."; }
  async function queue(actions: JobInput["requestedActions"]) {
    setError(""); setNotice("");
    try {
      const input = inputFor(actions);
      if (preview) { if (actions.email || actions.internalDelivery) throw new Error("Sign in and configure Firebase/SMTP to deliver certificates."); runWorker({ action: "zip", layout, rows: input.rows, background, rowOffset: batchStart - 1 }); return; }
      setBusy(true);
      if (background) { if (asset.current?.blob !== background) asset.current = { blob: background, id: (await uploadCertificateAsset(background, "background")).assetId }; input.backgroundAssetId = asset.current.id; }
      const digest = JSON.stringify(input); if (requestKey.current?.digest !== digest) requestKey.current = { digest, key: crypto.randomUUID() };
      const data = await certificateRequest<{ jobId: string }>("/jobs", { ...jsonRequest(input), headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey.current.key } });
      setJobId(data.jobId); setJobRows([]); setRowCursor(null); setTab("history"); setNotice("Batch queued. You can leave this page while it processes.");
    } catch (e) { setError(errorMessage(e)); } finally { if (!preview) setBusy(false); }
  }
  async function checkMatches() {
    setBusy(true); setError("");
    try { const result = await certificateRequest<{ matches: typeof matches }>("/match", jsonRequest(inputFor({ archive: true, email: sendEmail, internalDelivery: internal }))); setMatches(result.matches.map(match => ({ ...match, rowNumber: match.rowNumber + batchStart - 1 }))); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function saveDesign() {
    let backgroundData = "";
    if (background) backgroundData = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(background); });
    downloadBlob(new Blob([JSON.stringify({ version: 1, title, layout, backgroundData, emailSubject, emailBody }, null, 2)], { type: "application/json" }), "certificate-design.json");
  }
  async function loadDesign(file?: File) {
    if (!file) return;
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("Design file is too large");
      const data = JSON.parse(await file.text()), next = layoutSchema.parse(data.layout);
      if (data.backgroundData) {
        if (typeof data.backgroundData !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(data.backgroundData)) throw new Error("Invalid background");
        const blob = await (await fetch(data.backgroundData)).blob(); const bitmap = await createImageBitmap(blob); if (bitmap.width * bitmap.height > 8_000_000) throw new Error("Background too large"); bitmap.close(); setBackground(blob);
      } else { setBackground(undefined); setBackgroundUrl(""); }
      setLayout(next); setTitle(String(data.title || "Certificate").slice(0, 160)); setSelected(next.elements[0].id); setRows(current => current.map(r => ({ ...r, overrides: {} }))); setRowOnly(false); asset.current = null; setError("");
      if (typeof data.emailSubject === "string") setEmailSubject(data.emailSubject.slice(0, 200)); if (typeof data.emailBody === "string") setEmailBody(data.emailBody.slice(0, 10000));
    } catch (e) { setError(errorMessage(e)); }
  }
  async function jobAction(action: "retry" | "cancel") {
    setBusy(true); setError("");
    try { await certificateRequest(`/jobs/${jobId}`, jsonRequest({ action, retryUnknownEmail: retryUnknown }, "PATCH")); setNotice(action === "retry" ? "Retry queued. Previously completed deliveries are preserved." : "Batch cancelled. Completed deliveries are preserved."); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="cert-builder">
    <header className="cert-hero"><div><span className="eyebrow violet">MAKE ACHIEVEMENTS OFFICIAL</span><h1>Certificate studio<span>✦</span></h1><p>One thoughtful design. Every attendee celebrated.</p></div><span className="cert-hero-stamp"><Award size={34} /><b>MADE TO<br />BE EARNED</b></span></header>
    <div className="cert-topline"><label className="cert-title"><span>Certificate title</span><input value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></label><div className="cert-actions"><button onClick={() => void saveDesign()}><Download size={16} /> Save design</button><button onClick={() => designInput.current?.click()}><Upload size={16} /> Open design</button><input ref={designInput} type="file" accept=".json" hidden onChange={e => { void loadDesign(e.target.files?.[0]); e.target.value = ""; }} /></div></div>
    <nav className="cert-tabs" aria-label="Certificate workflow">{(["design", "delivery", "history"] as const).map((id, i) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>0{i + 1}</span>{id === "design" ? "Design & personalize" : id === "delivery" ? "Review & deliver" : "Batch history"}</button>)}</nav>
    {preview && <p className="cert-note">Preview workspace · Import up to 50,000 CSV attendees and export up to 100 certificates per batch locally. Sign in to save certificates to profiles or send email.</p>}
    {tab !== "history" && <div className="cert-batch-range"><div><b>{rows.length.toLocaleString()} attendees loaded</b><small>Export / delivery batch · {batchCount.toLocaleString()} selected · maximum {batchLimit.toLocaleString()} per batch</small></div><label>From row<input aria-label="Batch from row" type="number" min={1} max={rows.length} value={batchStart} disabled={busy} onChange={e => selectBatch(Math.max(1, Math.min(rows.length, Math.trunc(Number(e.target.value)) || 1)))} /></label><label>To row<input aria-label="Batch to row" type="number" min={batchStart} max={Math.min(rows.length, batchStart + batchLimit - 1)} value={batchEnd} disabled={busy} onChange={e => selectBatch(batchStart, Math.max(batchStart, Math.min(rows.length, batchStart + batchLimit - 1, Math.trunc(Number(e.target.value)) || batchStart)))} /></label><button disabled={busy || batchEnd >= rows.length} onClick={() => { selectBatch(batchEnd + 1); setRowIndex(batchEnd); }}>Next batch<ChevronRight size={16} /></button></div>}
    {error && <div className="cert-error" role="alert">{error}</div>}{notice && <div className="cert-notice" role="status">{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{notice}{busy && workerBusy && <button onClick={() => { worker.current?.terminate(); worker.current = null; setBusy(false); setNotice("Export cancelled."); setWorkerBusy(false); }}>Cancel</button>}</div>}
    {tab === "design" && <>
      <div className="cert-workspace">
        <aside className="cert-panel cert-sources"><h2>Start with your files</h2><label className="cert-upload"><Upload size={22} /><b>Upload background</b><small>PNG, JPG, WebP · up to 8 MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void setBackgroundFile(e.target.files?.[0]); e.target.value = ""; }} /></label>{background && <button className="cert-text-button" onClick={() => { setBackground(undefined); setBackgroundUrl(""); asset.current = null; }}>Use default background</button>}
          <label className="cert-upload cert-upload-data"><Layers size={22} /><b>Import attendees</b><small>CSV: 50 MB / 50,000 rows<br />XLSX: 8 MB / 2,000 rows</small><input type="file" accept=".csv,.xlsx" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) runWorker({ action: "parse", file }); e.target.value = ""; }} /></label>
          <button className="cert-text-button" onClick={() => downloadBlob(new Blob(["name,email,course\nAlex Morgan,alex@example.test,Campus Leadership\nSam Rivera,sam@example.test,Campus Leadership\n"], { type: "text/csv" }), "sample-attendees.csv")}>Download sample CSV</button>
          <div className="cert-field-connections"><h2>Connect certificate fields</h2><p className="cert-help">Choose which attendee column fills each placeholder. Common headings connect automatically.</p>{certificateFields.map(field => <label key={field}>{`{{${field}}}`}<select aria-label={`Column for ${field}`} value={resolveColumn(field, headers) || ""} onChange={e => connectField(field, e.target.value)}><option value="">Choose a column</option>{headers.map(h => <option key={h} value={h}>{h}</option>)}</select></label>)}{unmappedFields.length > 0 && <p className="cert-mapping-warning" role="status">Missing columns for {unmappedFields.map(field => `{{${field}}}`).join(", ")}. Connect them above, or edit the layer text to remove unused placeholders.</p>}</div>
          <h2>Variables <small>{headers.length} columns + code</small></h2><p className="cert-help">Drag a variable onto the canvas, or tap to add.</p><div className="cert-variables">{[VERIFICATION_VARIABLE, ...headers].map(h => <button key={h} draggable onDragStart={e => e.dataTransfer.setData("text/certificate-column", h)} onClick={() => addVariable(h)}>{`{{${h}}}`}</button>)}</div><p className="cert-help">Verification codes are assigned during server generation. Local previews print “PREVIEW ONLY” and cannot be verified. <a href="/verify" target="_blank" rel="noreferrer">Open verification portal</a></p>
          <h2>Layers <button aria-label="Add text" onClick={() => addVariable("")}><Plus size={16} /></button></h2><div className="cert-layers">{layout.elements.map((e, i) => <button key={e.id} className={e.id === selected ? "active" : ""} onClick={() => setSelected(e.id)}><small>{i + 1}</small><span>{e.text.slice(0, 55)}</span>{row.overrides[e.id] && <b title="Overridden for this row">•</b>}</button>)}</div>
        </aside>
        <div className="cert-editor"><div className="cert-editor-bar"><b>Live preview</b><div><button aria-label="Zoom out" onClick={() => setZoom(v => Math.max(0.25, v - 0.1))}><ZoomOut size={17} /></button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}% · Fit</button><button aria-label="Zoom in" onClick={() => setZoom(v => Math.min(3, v + 0.1))}><ZoomIn size={17} /></button></div></div>
          {fontsReady ? <CertificateCanvas layout={layout} row={row} selected={selected} select={setSelected} change={change} backgroundUrl={backgroundUrl} zoom={zoom} setZoom={setZoom} addVariable={addVariable} /> : <div className="cert-empty">Loading certificate fonts…</div>}
          <div className="cert-row-bar"><button aria-label="Previous attendee" disabled={!rowIndex} onClick={() => setRowIndex(i => i - 1)}><ChevronLeft size={18} /></button><label>Row <input aria-label="Preview row" type="number" min={1} max={rows.length} value={rowIndex + 1} onChange={e => setRowIndex(Math.max(0, Math.min(rows.length - 1, Number(e.target.value) - 1)))} /> of {rows.length}</label><button aria-label="Next attendee" disabled={rowIndex >= rows.length - 1} onClick={() => setRowIndex(i => i + 1)}><ChevronRight size={18} /></button><span>{row.values[mapping.displayName] || Object.values(row.values)[0]}</span></div>
          <details className="cert-attendee-preview" open><summary>Attendee data · Row {rowIndex + 1} · {importName}</summary><dl>{headers.map(h => <div key={h}><dt>{h}</dt><dd>{row.values[h] || <em>Empty</em>}</dd></div>)}</dl>{importWarnings.length > 0 && <details><summary>Import adjustments ({importWarnings.length})</summary><ul>{importWarnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}</details>
          <div className="cert-override"><label><input type="checkbox" checked={rowOnly} onChange={e => setRowOnly(e.target.checked)} /><b>Edit only Row {rowIndex + 1}</b></label><small>{rowOnly ? "Changes apply to this attendee only, including dragging and styling." : "Changes apply to the template. Existing row overrides are preserved."}</small>{Object.keys(row.overrides).length > 0 && <button onClick={() => setRows(current => current.map((r, i) => i === rowIndex ? { ...r, overrides: {} } : r))}>Reset row overrides</button>}</div>
        </div>
        <aside className="cert-panel cert-inspector"><h2>Text properties</h2>{activeElement ? <>
          <label>Text / variables<textarea rows={3} value={currentText} onChange={e => change({ text: e.target.value })} maxLength={2000} /></label>
          <label>Font family<select value={activeElement.fontFamily} onChange={e => change({ fontFamily: e.target.value as TextElement["fontFamily"] })}>{FONTS.map(f => <option key={f}>{f}</option>)}</select></label>
          <div className="cert-field-pair"><label>Size<input type="number" min={8} max={300} value={activeElement.fontSize} onChange={e => change({ fontSize: Math.max(8, Math.min(300, Number(e.target.value))) })} /></label><label>Color<input type="color" value={activeElement.color} onChange={e => change({ color: e.target.value })} /></label></div>
          <div className="cert-style-buttons"><button className={activeElement.bold ? "active" : ""} aria-pressed={activeElement.bold} onClick={() => change({ bold: !activeElement.bold })}><b>B</b></button><button className={activeElement.italic ? "active" : ""} aria-pressed={activeElement.italic} onClick={() => change({ italic: !activeElement.italic })}><i>I</i></button>{(["left", "center", "right"] as const).map(align => <button key={align} aria-label={`Align ${align}`} className={activeElement.align === align ? "active" : ""} onClick={() => change({ align })}>{align[0].toUpperCase()}</button>)}</div>
          <div className="cert-field-pair">{(["x", "y", "width", "height", "rotation", "lineHeight"] as const).map(field => <label key={field}>{field}<input type="number" step={field === "lineHeight" ? 0.1 : 1} value={Math.round(activeElement[field] * 100) / 100} onChange={e => change({ [field]: Number(e.target.value) })} /></label>)}</div>
          <label className="cert-check"><input type="checkbox" checked={activeElement.shadow.enabled} onChange={e => change({ shadow: { ...activeElement.shadow, enabled: e.target.checked } })} />Text shadow</label>
          {activeElement.shadow.enabled && <><label>Shadow color<input type="color" value={activeElement.shadow.color} onChange={e => change({ shadow: { ...activeElement.shadow, color: e.target.value } })} /></label><div className="cert-field-pair">{(["blur", "offsetX", "offsetY", "opacity"] as const).map(field => <label key={field}>{field}<input type="number" step={field === "opacity" ? 0.1 : 1} value={activeElement.shadow[field]} onChange={e => change({ shadow: { ...activeElement.shadow, [field]: Number(e.target.value) } })} /></label>)}</div></>}
          <p className="cert-help">Long text wraps inside its box. Increase the box size or reduce the font for individual rows.</p>
          <button className="cert-danger" onClick={() => { if (layout.elements.length === 1) return setError("Keep at least one text layer."); setLayout(current => ({ ...current, elements: current.elements.filter(e => e.id !== selected) })); setRows(current => current.map(r => ({ ...r, overrides: Object.fromEntries(Object.entries(r.overrides).filter(([id]) => id !== selected)) }))); setSelected(""); }}><Trash2 size={15} /> Delete layer</button>
        </> : <p className="cert-help">Select a layer to change its text and style.</p>}</aside>
      </div><footer className="cert-footer"><span><b>{batchCount} certificates · Rows {batchStart}–{batchEnd}</b> · Full-resolution PNG export</span><div><button disabled={busy} onClick={() => void queue({ archive: true, email: false, internalDelivery: false })}><Download size={17} />Download as ZIP</button><button className="cert-primary" onClick={() => setTab("delivery")}>Review & deliver<ArrowRight size={17} /></button></div></footer>
    </>}
    {tab === "delivery" && <div className="cert-delivery"><section className="cert-panel"><h2>Connect your attendees</h2><p>Match an email or exact username. Unmatched attendees still receive email when an address is available.</p><label>Event (optional)<select value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Standalone certificate</option>{events.filter(e => e.canManageEvent).map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>{(["email", "username", "displayName"] as const).map(key => <label key={key}>{key === "displayName" ? "Recipient name column" : `${key} column`}<select value={mapping[key]} onChange={e => { setMapping(m => ({ ...m, [key]: e.target.value })); setMatches([]); }}><option value="">Not mapped</option>{headers.map(h => <option key={h}>{h}</option>)}</select></label>)}
      <label className="cert-check"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} />Save to profiles and Smart Campus Chat</label><label className="cert-check"><input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} />Email certificates as PNG attachments</label><label className="cert-check"><input type="checkbox" checked={distinctAwards} onChange={e => setDistinctAwards(e.target.checked)} />Rows for the same recipient are distinct awards</label><button disabled={preview || busy} onClick={() => void checkMatches()}>Check internal matches</button>{matches.length > 0 && <div className="cert-match-report"><b>{matches.filter(m => m.status === "matched").length} of {matches.length} matched</b>{matches.filter(m => m.status !== "matched").slice(0, 20).map(m => <p key={m.rowNumber}>Row {m.rowNumber}: {m.reason}</p>)}</div>}</section>
      <section className="cert-panel"><h2>Your email, in your words</h2><p>Use any imported column as a variable, for example {"{{name}}"}.</p><label>Subject<input value={emailSubject} maxLength={200} onChange={e => setEmailSubject(e.target.value)} /></label><label>Message<textarea rows={9} value={emailBody} maxLength={10000} onChange={e => setEmailBody(e.target.value)} /></label><div className="cert-mail-preview"><small>PREVIEW · ROW {rowIndex + 1}</small><h3>{substitute(emailSubject, row.values)}</h3><p>{substitute(emailBody, row.values)}</p><span>📎 certificate-{rowIndex + 1}.png</span></div>
        {preview && <div className="cert-note" id="certificate-delivery-unavailable"><strong>Email delivery is unavailable in preview mode.</strong><p>Your attendees are ready to preview and export. To send them, the workspace administrator must configure the email service and database, enable sign-in, and start the certificate delivery worker. Then sign in with your account.</p><p>You can download the certificates as a ZIP from Design &amp; personalize while delivery is being set up.</p></div>}
        <button className="cert-primary" aria-describedby={preview ? "certificate-delivery-unavailable" : undefined} disabled={busy || preview || (!sendEmail && !internal)} onClick={() => void queue({ archive: true, email: sendEmail, internalDelivery: internal })}><Mail size={17} />{sendEmail ? `Email Certificates · ${batchCount} recipients` : `Deliver ${batchCount} certificates`}</button></section></div>}
    {tab === "history" && <div className="cert-history"><section className="cert-panel"><h2>Your batches</h2>{!history.length && <p>{preview ? "Sign in to save batches and track delivery." : "No batches yet. Export or deliver your first design."}</p>}{history.map(item => <button key={item.id} className={`cert-job ${jobId === item.id ? "active" : ""}`} onClick={() => { setJobId(item.id); setJobRows([]); setRowCursor(null); }}><b>{item.title}</b><span>{item.status.replaceAll("_", " ")} · {item.processedRows}/{item.totalRows}</span></button>)}</section><section className="cert-panel"><h2>{job?.title || "Batch progress"}</h2>{job ? <><p>{job.status.replaceAll("_", " ")} · {job.processedRows} of {job.totalRows} processed · {job.failedRows} need review</p><progress value={job.processedRows} max={job.totalRows} />{job.lastError && <p className="cert-error">{job.lastError}</p>}<div className="cert-actions">{job.archiveStatus === "ready" && <a className="cert-primary" href={`/api/certificates/jobs/${jobId}/download`}><Download size={16} />Download ZIP</a>}{["queued", "running"].includes(job.status) && <button disabled={busy} onClick={() => void jobAction("cancel")}>Cancel remaining work</button>}{["draft", "retrying", "failed", "completed_with_errors", "cancelled"].includes(job.status) && <button disabled={busy} onClick={() => void jobAction("retry")}>Retry incomplete work</button>}</div><label className="cert-check"><input type="checkbox" checked={retryUnknown} onChange={e => setRetryUnknown(e.target.checked)} />Also retry unknown email outcomes (may send duplicates)</label><div className="cert-table-scroll"><table><thead><tr><th>Row</th><th>PNG</th><th>Match</th><th>Profile / chat</th><th>Email</th></tr></thead><tbody>{jobRows.map(r => <tr key={r.id}><td>{r.rowNumber}</td><td>{r.imageUrl ? <a href={r.imageUrl} target="_blank" rel="noreferrer">View PNG</a> : r.renderStatus}</td><td>{r.matchStatus}</td><td>{r.internalStatus}</td><td title={r.lastError}>{r.emailStatus}{r.lastError && <small>{r.lastError}</small>}</td></tr>)}</tbody></table></div>{rowCursor && <button onClick={async () => { try { const next = await certificateRequest<{ rows: RowStatus[]; nextCursor: string | null }>(`/jobs/${jobId}?cursor=${rowCursor}`); setJobRows(current => [...current, ...next.rows]); setRowCursor(next.nextCursor); } catch (e) { setError(errorMessage(e)); } }}>Load more rows</button>}<p className="cert-help">Accepted means the SMTP server accepted the message. It does not confirm inbox delivery. Unmatched accounts skip internal delivery.</p></> : <p>Select a batch to see image generation and delivery status.</p>}</section></div>}
  </section>;
}
