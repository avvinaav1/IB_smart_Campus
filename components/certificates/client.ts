import { announceDataChange, mutationSucceeded } from "@/lib/client-data-sync";

export async function certificateRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/certificates${path}`, { cache: "no-store", ...init });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Certificate request failed");
  if (mutationSucceeded(init)) announceDataChange();
  return result.data as T;
}
export function jsonRequest(body: unknown, method = "POST"): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
export async function uploadCertificateAsset(file: Blob, kind: "background" | "certificate") {
  const form = new FormData(); form.append("file", file, "certificate.png"); form.append("kind", kind);
  return certificateRequest<{ assetId: string; url: string }>("/assets", { method: "POST", body: form });
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
