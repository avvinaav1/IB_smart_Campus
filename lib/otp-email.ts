import type { AuthIntent } from "@/lib/auth-store";

export async function sendOtpEmail(email: string, code: string, intent: AuthIntent | "change-email") {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM_EMAIL;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured.");
    console.info(`[Smart Campus auth] ${intent} code for ${email}: ${code}`);
    return { delivered: false as const };
  }

  const action = intent === "register" ? "create your Smart Campus account" : intent === "login" ? "log in to Smart Campus" : "confirm your new Smart Campus email";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${code} is your Smart Campus code`,
      text: `Use ${code} to ${action}. This code expires in 10 minutes. If you did not request it, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px"><h1 style="font-size:24px">Your Smart Campus code</h1><p>Use this code to ${action}:</p><p style="font-size:36px;font-weight:800;letter-spacing:8px;margin:24px 0">${code}</p><p style="color:#6d6878">It expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
    }),
  });

  if (!response.ok) throw new Error(`Email provider rejected the request (${response.status}).`);
  return { delivered: true as const };
}
