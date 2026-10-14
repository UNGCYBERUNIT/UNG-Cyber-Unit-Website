// Sends via Resend's HTTP API (https://resend.com) rather than Cloudflare's
// own Email Sending product — that requires a paid plan; Resend's free tier
// (3,000/mo) covers this app's verification-email volume with a plain
// fetch() call, no SDK/binding needed. Throws on failure; caller decides how
// to surface that to the requester.
//
// `from` defaults to the shared noreply@ address but can be overridden per
// call — e.g. Kanban's notifications use kanban@ungcyberunit.org, since a
// "noreply@" local part is a well-known spam-score signal some mail
// gateways (university O365/Defender tenants especially) weight heavily,
// independent of SPF/DKIM passing. Same verified domain either way, so no
// DNS changes are needed to use a different local part.
export async function sendResendEmail(env, { to, subject, html, text, from = 'CyberUnit @ UNG <noreply@ungcyberunit.org>' }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
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
