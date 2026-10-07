// ── Web Exploitation Lab: deliberately forgeable "Remember Me" token ───────
// Backs the "None the Wiser" part of "Breach the Portal" (ctfModules id
// 'web-exploitation', part 'jwt-forge'). A real, historically common JWT
// bug: the verifier below trusts whatever `alg` the token's OWN header
// claims instead of pinning it to HS256 server-side, so a token with
// alg:"none" skips the signature check entirely and its payload is
// trusted as-is. Completely separate from this site's real auth
// (lib/auth.js's signJWT()/verifyJWT(), which always hardcode HS256 and
// env.JWT_SECRET) — never reuse this pattern, or this secret, for real
// auth. Kept in its own file, never imported by lib/auth.js or vice versa,
// so the real and fake auth paths can never be confused for one another.
// The secret itself lives in env.WEBEXPLOIT_JWT_SECRET (wrangler secret,
// .dev.vars locally) — not hardcoded here — purely so it isn't sitting in
// this public repo where anyone could read it and properly sign a forged
// token without ever discovering the alg:none bug that's the actual point
// of the challenge.

export function labB64uEncode(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
export function labB64uDecode(str) {
  return JSON.parse(atob(str.replace(/-/g, '+').replace(/_/g, '/')));
}

export async function labIssueRememberToken(payload, secret) {
  const header = labB64uEncode({ alg: 'HS256', typ: 'JWT' });
  const body = labB64uEncode(payload);
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${data}.${sigB64}`;
}

// Returns the decoded payload if the token passes this endpoint's (broken)
// rules, or null. THE BUG lives in the alg:"none" branch below — it returns
// the payload with no signature verification at all.
export async function labVerifyRememberToken(token, secret) {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header, payload;
  try {
    header = labB64uDecode(h);
    payload = labB64uDecode(p);
  } catch { return null; }

  if (header.alg === 'none') return payload;

  if (header.alg === 'HS256') {
    try {
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
      );
      const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${h}.${p}`));
      return valid ? payload : null;
    } catch { return null; }
  }

  return null;
}
