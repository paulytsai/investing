// Transactional email via Resend (https://resend.com). When RESEND_API_KEY is not set,
// sendMail() returns { sent: false } and callers fall back to showing the admin the link.
export function mailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail({ to, subject, text, html, replyTo }) {
  if (!mailConfigured()) return { sent: false, reason: "not_configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, html: html || `<pre style="font-family:sans-serif;white-space:pre-wrap">${text}</pre>`, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`mail send failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { sent: true, id: (await res.json()).id };
}
