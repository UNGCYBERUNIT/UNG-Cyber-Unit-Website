// ─── CTF Challenge Module Data & Rendering ───────────────────────────────────
// Single source of truth for the /challenges hub, CHALLENGE_PARTS (answer
// grading structure), and per-part scoring — see worker.js's "CTF Challenge
// Modules" comment / docs/plan-intermediate-track.md for the full rationale.

import { escapeHtml } from '../lib/render.js';

// ─── CTF Challenge Modules ──────────────────────────────────────────────────
// Single source of truth for the /challenges hub page and CHALLENGE_PARTS
// (below), so the two can never drift out of sync the way two independently
// hand-kept lists could. Legacy modules (log-analysis-regex, wireshark-nta)
// carry just enough metadata to list on the hub and derive their parts —
// pageUrl points at their existing bespoke HTML page, which stays untouched.
// New modules will carry full briefing/downloads/toolbox content and get
// server-rendered generically at /challenges/:id — see
// docs/plan-intermediate-track.md before adding one.
export const ctfModules = [
  {
    id: 'log-analysis-regex',
    title: 'Log Analysis & Regex Workshop',
    category: 'Log Analysis',
    difficulty: 'Beginner',
    shortDesc: 'Hunt for indicators of compromise across five real-world-style logs using regex.',
    pageUrl: '/log-analysis-challenge',
    parts: ['challenge-1', 'challenge-2', 'challenge-3', 'challenge-4', 'challenge-5'],
  },
  {
    id: 'wireshark-nta',
    title: 'Network Traffic Analysis & Wireshark',
    category: 'Network Forensics',
    difficulty: 'Beginner',
    shortDesc: 'Spot a cleartext credential leak in a live-captured packet trace.',
    pageUrl: '/network-traffic-challenge',
    parts: ['live-demo'],
  },
  {
    id: 'crypto-layers',
    title: 'Layers of Secrecy',
    category: 'Cryptography',
    difficulty: 'Intermediate',
    shortDesc: 'Peel back two independently-encoded blocks from an intercepted transmission.',
    pageUrl: '/challenges/crypto-layers',
    downloads: [
      { filename: 'layers.txt', label: 'Intercepted Transmission', desc: 'Both encoded blocks, plus analyst notes' },
    ],
    toolbox: [
      { name: 'CyberChef', desc: 'Drag-and-drop encode/decode recipes — From Base64, ROT13 Brute Force, Vigenère Decode.' },
      { name: 'base64 (CLI)', desc: '`base64 -d` decodes a Base64 block from the command line.' },
      { name: 'Vigenère cipher', desc: 'A repeating-key substitution cipher — same key length as the alphabet shift pattern repeats.' },
    ],
    briefing: {
      sections: [
        {
          heading: 'Situation',
          body: 'A two-block transmission was intercepted off an open relay. Each block was encoded independently, and neither uses an exotic format — just text transformations you can reverse by hand or with a tool.',
        },
      ],
    },
    parts: [
      {
        id: 'layer-1',
        title: 'Unwrap Block One',
        difficulty: 'easy',
        desc: 'Block One has two layers: an outer wrapper you\'ll recognize instantly, and an inner substitution cipher that shifts every letter by the same fixed amount.',
        targetFile: 'layers.txt (Block One)',
      },
      {
        id: 'layer-2',
        title: 'Break Block Two',
        difficulty: 'medium',
        desc: 'Block Two resists a straight single-shift guess — it\'s a repeating-key cipher. The analyst notes hint at the keyword.',
        targetFile: 'layers.txt (Block Two)',
      },
    ],
    ethicsNotice: false,
  },
  {
    id: 'hidden-in-plain-sight',
    title: 'Hidden in Plain Sight',
    category: 'File Forensics',
    difficulty: 'Intermediate',
    shortDesc: 'A leaked draft image is hiding two independent flags — one in the pixels, one in the metadata.',
    pageUrl: '/challenges/hidden-in-plain-sight',
    downloads: [
      { filename: 'network_topology_draft.png', label: 'Leaked Draft Image', desc: 'A PNG that leaked before its review was finished' },
    ],
    toolbox: [
      { name: 'exiftool', desc: 'Reads (and writes) embedded metadata — always check this first on any leaked file.' },
      { name: 'zsteg / stegsolve', desc: 'Purpose-built LSB-steganography scanners for PNG/BMP images.' },
      { name: 'A few lines of Python (Pillow)', desc: 'LSB data is just the last bit of each pixel channel — trivial to read yourself once you know that.' },
    ],
    briefing: {
      sections: [
        {
          heading: 'Situation',
          body: 'This PNG leaked from an internal review queue before it was supposed to go out. Nothing about the image itself looks unusual at a glance — that\'s the point. Two independent pieces of hidden information are in this single file, using two completely different techniques. Finding one tells you nothing about how to find the other.',
        },
      ],
    },
    parts: [
      {
        id: 'metadata-flag',
        title: 'Check What Shipped With It',
        difficulty: 'easy',
        desc: 'Files carry more than what you see rendered on screen. Every export tool, camera, and editor tends to leave something behind in the file\'s metadata — sometimes a lot more than intended.',
        targetFile: 'network_topology_draft.png',
      },
      {
        id: 'pixel-flag',
        title: 'Look Past the Pixels',
        difficulty: 'medium',
        desc: 'The image itself is hiding a message in its least significant bits — the part of each pixel\'s color value that changes the color so slightly the human eye can\'t tell the difference, but a script can read perfectly.',
        targetFile: 'network_topology_draft.png',
      },
    ],
    ethicsNotice: false,
  },
  {
    id: 'crack-the-vault',
    title: 'Crack the Vault',
    category: 'Password Auditing',
    difficulty: 'Intermediate',
    shortDesc: 'Two recovered password hashes, one small wordlist — recover the weaker of the two passwords.',
    pageUrl: '/challenges/crack-the-vault',
    downloads: [
      { filename: 'hashes.txt', label: 'Credential Dump', desc: 'Two username:hash pairs, MD5, unsalted' },
      { filename: 'wordlist.txt', label: 'Candidate Wordlist', desc: '32 candidate passwords — both real ones are in here' },
    ],
    toolbox: [
      { name: 'hashcat', desc: '`hashcat -m 0 -a 0 hashes.txt wordlist.txt` — mode 0 is raw MD5.' },
      { name: 'John the Ripper', desc: '`john --format=raw-md5 --wordlist=wordlist.txt hashes.txt` works just as well.' },
      { name: 'A one-line Python loop', desc: 'For a wordlist this small, hashing every candidate yourself and comparing is completely reasonable — that\'s the whole lesson.' },
    ],
    briefing: {
      sections: [
        {
          heading: 'Situation',
          body: 'A small credential dump was recovered — two accounts, both MD5, no salt. That alone should bother you (MD5 is fast to brute-force and salting is what prevents this exact attack), but tonight you\'re on offense: recover the weaker of the two passwords using the provided wordlist.',
        },
      ],
    },
    parts: [
      {
        id: 'weak-password',
        title: 'Recover the Weaker Password',
        difficulty: 'easy',
        desc: 'One of these two hashes will fall to the wordlist almost instantly. Find it and submit the plaintext password (not the hash, not the username).',
        targetFile: 'hashes.txt + wordlist.txt',
      },
    ],
    ethicsNotice: true,
  },
  {
    id: 'web-exploitation',
    title: 'Breach the Portal',
    category: 'Web Exploitation',
    difficulty: 'Advanced',
    shortDesc: 'A live, genuinely vulnerable employee login page — find the flaw and read data you shouldn\'t be able to.',
    pageUrl: '/challenges/web-exploitation',
    target: {
      url: '/lab/web-exploitation-portal',
      label: 'Employee Portal (Live Target)',
      desc: 'A real running login page — this one is actually exploitable, not a simulation',
      icon: '🎯',
    },
    toolbox: [
      { name: 'Your browser', desc: 'No special tools needed for any of this — your browser and its built-in DevTools are enough.' },
      { name: 'View Page Source / DevTools', desc: 'Ctrl+U (or right-click → View Page Source) shows the raw HTML, including anything left behind in comments that never renders on the page itself.' },
    ],
    briefing: {
      sections: [
        {
          heading: 'Situation',
          body: 'A small internal tool for the campus IT team leaked its login URL. It\'s a basic username/password form — nothing fancy. Nothing about the page itself hints at a problem. Start by taking a look at what actually shipped in it.',
        },
      ],
    },
    parts: [
      {
        id: 'source-recon',
        title: 'Read Between the Lines',
        difficulty: 'easy',
        desc: 'Developers leave things behind in HTML comments they forget are visible to anyone who looks — view the portal\'s page source and see what turns up.',
        targetFile: '/lab/web-exploitation-portal (page source)',
      },
      {
        id: 'auth-bypass',
        title: 'Bypass the Login',
        difficulty: 'medium',
        desc: 'You don\'t have a valid password for any account — you\'re not supposed to. Get past the login anyway, land in the administrator\'s account, and read what\'s sitting in their notes.',
      },
      {
        id: 'cookie-hijack',
        title: 'Broken Trust',
        difficulty: 'medium',
        desc: 'The login form isn\'t the only way in. Something else this app does trusts you without ever really checking who you are.',
      },
      {
        id: 'jwt-forge',
        title: 'None the Wiser',
        difficulty: 'hard',
        desc: 'There\'s a "Remember Me" feature now too, and it hands out tokens to anyone who asks. Not every token that looks signed actually gets checked.',
      },
    ],
    ethicsNotice: true,
  },
];

// SEO meta block for a generic (new-style) CTF module page, same shape as
// topicMetaTags() — see that function for the escaping/breadcrumb rationale.
export function challengeModuleMetaTags(m) {
  const title = escapeHtml(`${m.title} — UNG Cyber Unit`);
  const desc = escapeHtml(`${m.shortDesc} A CTF-style cybersecurity challenge from the UNG Cyber Unit.`);
  const canonical = `https://ungcyberunit.org${m.pageUrl}`;
  const image = 'https://ungcyberunit.org/images/CyberUnitLogo_Transparent.png';
  const breadcrumb = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://ungcyberunit.org/' },
      { '@type': 'ListItem', position: 2, name: 'CTF Challenges', item: 'https://ungcyberunit.org/challenges' },
      { '@type': 'ListItem', position: 3, name: m.title, item: canonical },
    ],
  }).replace(/</g, '\\u003c');
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="UNG Cyber Unit">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta name="twitter:card" content="summary">`,
    `<script type="application/ld+json">${breadcrumb}</script>`,
  ].join('\n  ');
}

// Full server-rendered body content for a generic CTF module page — briefing,
// downloads, toolbox, challenge parts, optional ethics notice. Injected into
// public/challenge-module.html's placeholder by the /challenges/:id route.
// No client re-render needed (unlike topics): this content is fully static
// per module, main.js only layers on progress/submit behavior afterward.
export function renderChallengeModule(m) {
  const downloads = (m.downloads ?? []).map(d => `
          <a class="card lac-download-card" href="/challenges/${m.id}/${d.filename}" download>
            <span class="lac-download-icon" aria-hidden="true">${d.icon ?? '📁'}</span>
            <span class="lac-download-name">${escapeHtml(d.label)}</span>
            <span class="lac-download-desc">${escapeHtml(d.desc)}</span>
          </a>`).join('');

  const toolbox = (m.toolbox ?? []).map(t => `
          <div class="card lac-tool">
            <span class="lac-tool-name">${escapeHtml(t.name)}</span>
            <span class="lac-tool-desc">${escapeHtml(t.desc)}</span>
          </div>`).join('');

  const briefingHtml = (m.briefing?.sections ?? []).map(s => `
        <h2 class="instructor-section-heading">// ${escapeHtml(s.heading)}</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin: 0.5rem 0 1.5rem;">${escapeHtml(s.body)}</p>`).join('');

  const ethics = m.ethicsNotice ? `
      <div class="card lac-ethics" style="margin-bottom: 2rem;">
        <strong>Stay in scope.</strong> Every artifact here is synthetic — built for this
        challenge, not captured from a real system. Apply the same techniques
        only against systems you own or are explicitly authorized to test.
      </div>` : '';

  const parts = (m.parts ?? []).map((p, i) => `
        <div class="card lac-challenge" data-part-id="${escapeHtml(p.id)}">
          <div class="lac-challenge-head">
            <span class="lac-challenge-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="lac-difficulty lac-difficulty--${escapeHtml(p.difficulty ?? 'easy')}">${escapeHtml((p.difficulty ?? 'easy').replace('-', ' '))}</span>
          </div>
          <h3 class="lac-challenge-title">${escapeHtml(p.title)}</h3>
          <p class="lac-challenge-desc">${escapeHtml(p.desc)}</p>
          ${p.targetFile ? `<span class="lac-target-file"><span class="lac-target-label">Target file:</span> <span class="lac-target-name">${escapeHtml(p.targetFile)}</span></span>` : ''}
          <div class="lac-submit">
            <form class="lac-answer-form">
              <input type="text" class="lac-answer-input" placeholder="Your flag" aria-label="Your answer" autocomplete="off" maxlength="200">
              <button type="submit" class="btn btn-sm">Submit</button>
            </form>
            <p class="lac-answer-feedback" hidden></p>
          </div>
        </div>`).join('');

  // Live-target modules (e.g. web exploitation) attack a real running app
  // instead of a downloaded file — no "Download" section for those, a
  // "Target" section with a link to the live app instead.
  const targetSection = m.target ? `
      <section class="instructor-section">
        <h2 class="instructor-section-heading">// Target</h2>
        <div class="lac-downloads">
          <a class="card lac-download-card" href="${m.target.url}" target="_blank" rel="noopener noreferrer">
            <span class="lac-download-icon" aria-hidden="true">${m.target.icon ?? '🎯'}</span>
            <span class="lac-download-name">${escapeHtml(m.target.label)}</span>
            <span class="lac-download-desc">${escapeHtml(m.target.desc)}</span>
          </a>
        </div>
      </section>` : '';

  const downloadsSection = downloads ? `
      <section class="instructor-section">
        <h2 class="instructor-section-heading">// Download</h2>
        <div class="lac-downloads">${downloads}</div>
      </section>` : '';

  return `
      <header style="margin-bottom: 1.5rem;">
        <h1>// ${escapeHtml(m.title)}</h1>
        <p style="color: var(--text-muted); font-family: 'Share Tech Mono', monospace; font-size: 0.85rem; margin: 0.4rem 0 0;">
          ${escapeHtml(m.shortDesc ?? '')}
        </p>
      </header>

      ${ethics}
      ${targetSection}
      ${downloadsSection}

      <section class="instructor-section">
        <h2 class="instructor-section-heading">// Your Toolbox</h2>
        <div class="lac-toolbox">${toolbox}</div>
      </section>

      ${briefingHtml ? `<section class="instructor-section">${briefingHtml}</section>` : ''}

      <section class="instructor-section">
        <h2 class="instructor-section-heading">// The Challenge${(m.parts?.length ?? 0) > 1 ? 's' : ''}</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin: 0.5rem 0 1rem;">
          <span id="challengeProgressSummary" class="lac-progress-summary" hidden></span>
        </p>
        ${parts}
      </section>

      <section class="instructor-section" id="answerKeySection" hidden>
        <h2 class="instructor-section-heading">// Instructor Answer Key</h2>
        <a class="btn btn-sm" href="/api/challenges/${m.id}/answer-key">Download Answer Key</a>
      </section>

      ${challengeModuleNavHtml(m.id)}`;
}

// Prev/next/hub navigation, shown at the bottom of every CTF module page
// (both new-style and the two legacy pages) — wraps around at the ends.
// Order follows ctfModules array order, the same order the hub lists them in.
export function challengeModuleNavHtml(currentId) {
  const idx = ctfModules.findIndex(m => m.id === currentId);
  if (idx === -1) return '';
  const prev = ctfModules[(idx - 1 + ctfModules.length) % ctfModules.length];
  const next = ctfModules[(idx + 1) % ctfModules.length];
  return `
      <nav class="lac-module-nav" aria-label="Other CTF challenges">
        <a href="${prev.pageUrl}" class="lac-module-nav-link lac-module-nav-link--prev">
          <span class="lac-module-nav-arrow" aria-hidden="true">←</span>
          <span class="lac-module-nav-text"><span class="lac-module-nav-label">Previous</span>${escapeHtml(prev.title)}</span>
        </a>
        <a href="/challenges" class="lac-module-nav-hub">All Challenges</a>
        <a href="${next.pageUrl}" class="lac-module-nav-link lac-module-nav-link--next">
          <span class="lac-module-nav-text"><span class="lac-module-nav-label">Next</span>${escapeHtml(next.title)}</span>
          <span class="lac-module-nav-arrow" aria-hidden="true">→</span>
        </a>
      </nav>`;
}

// A single CTF module card for the /challenges hub grid — same visual
// language as topicCard()'s "module" cards, linking out to wherever the
// module's page actually lives (legacy bespoke page or, once any exist, a
// generic /challenges/:id page).
export function challengeCard(m) {
  const title = escapeHtml(m.title);
  return `<a href="${m.pageUrl}" class="card card-link" data-challenge="${m.id}" data-total-parts="${m.parts.length}" aria-label="${title}">
          <h3 class="card-title">${title}</h3>
          <p class="card-desc">${escapeHtml(m.shortDesc ?? '')}</p>
          <div class="card-footer">
            <span class="badge badge-${m.difficulty.toLowerCase()}">${escapeHtml(m.difficulty)}</span>
            <span class="card-desc" style="margin:0;">${escapeHtml(m.category)}</span>
          </div>
        </a>`;
}

// Server-rendered hub grid so crawlers/no-JS users see every module without
// depending on a client-side fetch — same philosophy as homeTopicCards().
export function challengesHubCards() {
  return ctfModules.map(challengeCard).join('\n        ');
}

export const CHALLENGE_PARTS = Object.fromEntries(
  ctfModules.map(m => [m.id, m.parts.map(p => (typeof p === 'string' ? p : p.id))])
);

// Difficulty-weighted point value per challenge part, used only by the CTF
// leaderboard endpoints below (challenge_completions has no score column of
// its own, unlike quiz_results/quiz_room_attempts, so points are computed
// here rather than summed in SQL). Legacy modules' parts are plain id
// strings with no difficulty annotation — they default to the easy tier.
const PART_DIFFICULTY_POINTS = { easy: 10, medium: 20, hard: 30 };
export const CHALLENGE_PART_POINTS = Object.fromEntries(
  ctfModules.map(m => [
    m.id,
    Object.fromEntries(m.parts.map(p => [
      typeof p === 'string' ? p : p.id,
      PART_DIFFICULTY_POINTS[typeof p === 'string' ? 'easy' : (p.difficulty ?? 'easy')] ?? PART_DIFFICULTY_POINTS.easy,
    ])),
  ])
);
