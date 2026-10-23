// Posts a message into a fixed channel via Discord's Bot REST API, using the
// same bot token the companion cyber_discord_bot repo already uses for its
// gateway connection — a bot token works identically for either, so the
// message really does appear as sent by the bot, not a separate webhook
// integration. Needs the DISCORD_TOKEN secret (`wrangler secret put
// DISCORD_TOKEN`) and env.DISCORD_NOTIFICATIONS_CHANNEL_ID (wrangler.toml
// [vars] — not sensitive, same as DISCORD_CLIENT_ID) set; the bot's own
// Discord application also needs "Send Messages" permission in that
// channel. Throws on failure, same contract as sendResendEmail() in
// email.js — caller decides how to surface that.
//
// allowedUserIds restricts which @mentions in `content` actually ping
// someone: allowed_mentions.parse is deliberately left empty (not
// ['users']) so an @everyone/@here/role mention accidentally typed into
// trusted-but-not-fully-controlled text (e.g. an instructor's Kanban card
// title) can never fire — only the explicit ids passed here can.
export async function sendDiscordMessage(env, content, { allowedUserIds = [] } = {}) {
  const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_NOTIFICATIONS_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [], users: allowedUserIds },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }
}
