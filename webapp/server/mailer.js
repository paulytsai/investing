// Email: Resend when RESEND_API_KEY is set; otherwise the dev outbox (logged, and listed at /dev/mail in development).
import { config } from "./config.js";
import { nowIso } from "./db.js";

export async function sendMail(db, to, subject, body) {
  if (config.resendApiKey) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text: body }),
    });
    if (!r.ok) { db.logError("mail", String(r.status), await r.text().catch(() => ""), { to }); throw new Error("mail_failed"); }
    return;
  }
  db.run("INSERT INTO dev_mail (at, to_email, subject, body) VALUES (?, ?, ?, ?)", nowIso(), to, subject, body);
  if (config.devMail && !process.env.NODE_TEST_CONTEXT) console.log(`[dev mail] to ${to}: ${subject}\n${body}\n`);
}
