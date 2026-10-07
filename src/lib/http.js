// ─── Low-level HTTP helpers ───────────────────────────────────────────────────
// Shared by every route module: the JSON response wrapper, the security
// header set applied to every response this Worker returns, the 404 page,
// and small request-parsing utilities with no further dependencies. Nothing
// in this file imports from anywhere else in src/ — it's the base layer
// every other module can safely depend on without creating a cycle.

export function addSecurityHeaders(headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  return headers;
}

export function jsonResponse(data, status = 200, extra = {}) {
  const h = new Headers({ 'Content-Type': 'application/json' });
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  addSecurityHeaders(h);
  return new Response(JSON.stringify(data), { status, headers: h });
}

// ─── 404 Page ─────────────────────────────────────────────────────────────────

export function notFoundResponse() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 — CyberUnit @ UNG</title>
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="stylesheet" href="/css/style.css">
  <style>
    .page-body { padding-top: 0; }
    .not-found-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: calc(100vh - 56px - 48px);
      text-align: center;
      padding: 2rem 1rem;
      box-sizing: border-box;
    }
    .not-found-code {
      font-size: clamp(5rem, 18vw, 10rem);
      color: var(--accent);
      line-height: 1;
      font-family: 'Share Tech Mono', monospace;
      text-shadow: 0 0 40px rgba(0,255,136,0.6), 0 0 12px rgba(0,255,136,0.4);
    }
    .not-found-msg {
      color: var(--accent);
      margin: 1.25rem 0 2rem;
      font-size: clamp(1rem, 2.5vw, 1.3rem);
      font-family: 'Share Tech Mono', monospace;
      text-shadow: 0 0 16px rgba(0,255,136,0.4);
    }
    .secret { color: var(--bg); font-size: 0.4rem; text-decoration: none; margin-left: 0.2rem; }
    .secret:hover { color: var(--bg); }
  </style>
</head>
<body>

  <nav class="navbar" role="navigation" aria-label="Main navigation">
    <div class="container">
      <a href="/" class="navbar-logo"><img src="/images/CyberUnitLogo_Transparent.png" alt="CyberUnit @ UNG" class="navbar-logo-img"><span class="navbar-logo-text">[ CyberUnit @ UNG ]</span></a>
      <button class="hamburger" id="hamburger" aria-label="Toggle navigation" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <ul class="navbar-links" id="navLinks">
        <li><a href="/">Home</a></li>
        <li><a href="/about">About</a></li>
        <li id="authNavItem"></li>
      </ul>
    </div>
  </nav>

  <main class="page-body">
    <div class="not-found-section">
      <div class="not-found-code">404</div>
      <p class="not-found-msg">// Page not found. This route doesn't exist.</p>
      <a href="/" class="btn">← Return to Home</a><a href="/danica" class="secret">·</a>
    </div>
  </main>

  <footer>
    CyberUnit @ UNG | Cybersecurity Intro Class | Built on Cloudflare Workers
  </footer>

  <script type="module" src="/js/main.js"></script>
</body>
</html>`;
  const headers = addSecurityHeaders(new Headers({ 'Content-Type': 'text/html; charset=utf-8' }));
  return new Response(html, { status: 404, headers });
}

export function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k.trim(), v.join('=').trim()];
    })
  );
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Confirm a base64 image payload's actual bytes match the declared type, so we
// never store arbitrary content (HTML/SVG/etc.) smuggled under an image label.
// Returns true only when the leading magic bytes match `type` (png|jpeg|webp).
export function base64ImageMatchesType(b64, type) {
  let bin;
  try { bin = atob(b64); } catch { return false; }
  const byte = i => bin.charCodeAt(i);
  if (type === 'png') {
    // 89 50 4E 47 0D 0A 1A 0A
    return bin.length > 8 &&
      byte(0) === 0x89 && byte(1) === 0x50 && byte(2) === 0x4e && byte(3) === 0x47 &&
      byte(4) === 0x0d && byte(5) === 0x0a && byte(6) === 0x1a && byte(7) === 0x0a;
  }
  if (type === 'jpeg') {
    // FF D8 FF
    return bin.length > 3 && byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
  }
  if (type === 'webp') {
    // "RIFF" .... "WEBP"
    return bin.length > 12 &&
      bin.slice(0, 4) === 'RIFF' && bin.slice(8, 12) === 'WEBP';
  }
  return false;
}

export function clientIP(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0].trim()
    || 'unknown';
}
