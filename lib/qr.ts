import "server-only";

import QRCode from "qrcode";

/**
 * Renders a check-in code as a standalone QR SVG. The payload is the raw
 * six-character code, so a scan yields exactly what the manual check-in field
 * expects. Error-correction level "M" tolerates a printed or on-screen ticket
 * being partly obscured.
 */
export async function checkInCodeSvg(code: string): Promise<string> {
  return QRCode.toString(code, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#14121a", light: "#ffffff" },
  });
}

const INVITE_QR_OPTIONS = {
  errorCorrectionLevel: "Q",
  margin: 2,
  color: { dark: "#14121a", light: "#ffffff" },
} as const;

/**
 * Renders a community invite link as a QR code. Level "Q" keeps posters and
 * screenshots scannable even when partly creased or covered.
 */
export async function communityInviteQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...INVITE_QR_OPTIONS, type: "svg" });
}

/** PNG variant for printing or sharing in chat apps that do not accept SVG. */
export async function communityInviteQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...INVITE_QR_OPTIONS, type: "png", width: 1024 });
}
