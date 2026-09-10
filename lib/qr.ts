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
