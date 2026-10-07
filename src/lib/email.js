// Sends via Resend's HTTP API (https://resend.com) rather than Cloudflare's
// own Email Sending product — that requires a paid plan; Resend's free tier
// (3,000/mo) covers this app's verification-email volume with a plain
// fetch() call, no SDK/binding needed. Throws on failure; caller decides how
// to surface that to the requester.
export async function sendResendEmail(env, { to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'CyberUnit @ UNG <noreply@ungcyberunit.org>',
      to,
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}
