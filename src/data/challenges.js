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

  // ─── OSINT Lab (4 modules) ────────────────────────────────────────────────
  // See Implementation Guide.md (repo root, untracked — contains real PII for
  // the Web Archaeology target, never commit it). pageUrl deliberately sits
  // under /labs/osint/... instead of the usual /challenges/... so these are
  // reachable at the lab's own URL scheme — handled by the same generic
  // /challenges/:id-style render path via a second route match in
  // src/routes/pages.js, not a second rendering system.
  {
    id: 'osint-reverse-image',
    title: 'Reverse Image Search',
    category: 'OSINT',
    difficulty: 'Intermediate',
    shortDesc: 'Identify an obscure landmark using nothing but a photo and reverse image search.',
    pageUrl: '/labs/osint/reverse-image',
    // Screenshots, so no embedded EXIF to begin with (confirmed with
    // exiftool) — filenames are deliberately generic per the original
    // guide's own instruction, so they don't give away the answer.
    images: [
      { filename: 'landmark-01.png', caption: 'Image 1' },
      { filename: 'landmark-02.png', caption: 'Image 2' },
    ],
    toolbox: [
      { name: 'Google Lens / Yandex Images / TinEye', desc: 'Upload the photo to at least two of these — Yandex often outperforms Google on obscure/non-Western subjects, TinEye\'s "Oldest" sort finds the first known copy online.' },
      { name: 'Right-click → "Search image with Google"', desc: 'The fastest way to kick off a reverse search straight from Chrome.' },
    ],
    briefing: {
      sections: [
        {
          heading: 'Situation',
          body: 'A photograph often contains more than what\'s visible at a glance. Reverse image search can match it to its original source or similar images, and visual clues — signs, architecture, vegetation, the people in frame — can pin down what you\'re looking at even without a direct match. Two images below, one question each: name the landmark.',
        },
      ],
    },
    // One question per image (not a generic "the photo" location/landmark
    // pair) — with exactly 2 images provided, each needs its own correct
    // answer, so each gets its own part. Tool-comparison/source-URL/EXIF
    // questions from the original spec were dropped entirely rather than
    // shrunk, since all three only made sense as instructor-reviewed free
    // text anyway.
    parts: [
      {
        id: 'q1-image-one',
        title: 'Identify Image 1',
        difficulty: 'medium',
        points: 15,
        desc: 'What landmark is shown in Image 1, and where is it located (city, country)?',
        hints: [
          { text: 'Try cropping the image to focus on a distinctive feature — the detail sitting on the rooftop.', cost: 2 },
          { text: 'This one is not in the United States.', cost: 2 },
        ],
      },
      {
        id: 'q2-image-two',
        title: 'Identify Image 2',
        difficulty: 'medium',
        points: 15,
        desc: 'What is the name of the monument shown in Image 2, and who (or what) does it commemorate?',
        hints: [
          { text: "The uniforms in the crowd are a strong clue to which branch of the U.S. military this honors.", cost: 2 },
          { text: 'The subject served during the Korean War.', cost: 2 },
        ],
      },
    ],
    ethicsNotice: false,
  },
  {
    id: 'osint-what3words',
    title: 'what3words Geocoding',
    category: 'OSINT',
    difficulty: 'Beginner',
    shortDesc: 'Turn two three-word addresses into real UNG/Dahlonega-area landmarks.',
    pageUrl: '/labs/osint/what3words',
    toolbox: [
      { name: 'what3words.com', desc: 'Type the three words (with or without the leading ///) into the search bar, then switch to satellite view to see buildings and landmarks around the pin.' },
    ],
    briefing: {
      sections: [
        {
          heading: 'Situation',
          body: 'what3words divides the planet into 3m × 3m squares, each with a unique three-word address. Emergency services and delivery companies already use it; as an OSINT analyst you may encounter one in a social post or a comms log. Both addresses below are UNG Dahlonega campus buildings.',
        },
      ],
    },
    // Trimmed to two on-campus buildings, both w3w addresses supplied and
    // verified by Joshua directly (not guide placeholders).
    parts: [
      {
        id: 'q1-dining-hall',
        title: '///stepfather.animates.astonish',
        difficulty: 'easy',
        points: 15,
        desc: 'What is the name of this UNG dining facility, and what is it commonly called by students?',
      },
      {
        id: 'q2-cottrell-center',
        title: '///unfortunately.airship.subscribers',
        difficulty: 'easy',
        points: 15,
        desc: 'What is the name of this UNG building? What academic programs does it house?',
        hints: [
          { text: 'Both locations in this challenge are UNG\'s Dahlonega campus buildings.', cost: 2 },
        ],
      },
    ],
    ethicsNotice: false,
  },
  {
    id: 'osint-whois-dns',
    title: 'WHOIS / DNS Reconnaissance',
    category: 'OSINT',
    difficulty: 'Intermediate',
    shortDesc: "Map the UNG Cyber Unit's own domain — registrar, nameservers, mail, and subdomains.",
    pageUrl: '/labs/osint/whois-dns',
    toolbox: [
      { name: 'who.is', desc: 'Web-based WHOIS lookup — registrar, registration dates, nameservers.' },
      { name: 'dig / nslookup', desc: '`dig A/MX/TXT/NS ungcyberunit.org` for the equivalent DNS records from a terminal.' },
      { name: 'dnsdumpster.com', desc: 'A faster way to enumerate subdomains than guessing prefixes one at a time.' },
    ],
    briefing: {
      sections: [
        {
          heading: 'Situation',
          body: "Every domain has a WHOIS record (registrar, creation/expiration dates, nameservers) and DNS records (A, MX, NS, TXT) showing what it points to and how its email is handled. This is often the first step in mapping an organization's digital footprint — and the target here is the club's own real domain, ungcyberunit.org.",
        },
      ],
    },
    // NOTE: WHOIS/DNS values below are current as of Implementation
    // Guide.md's writing (2026-10-29) — manual TODO: re-verify with `whois`/
    // `dig` before each semester's lab, since expiration/IP/MX data drifts.
    parts: [
      {
        id: 'q1-registrar',
        title: 'Find the Registrar',
        difficulty: 'easy',
        points: 5,
        desc: 'Who is the registrar for ungcyberunit.org?',
      },
      {
        id: 'q2-created',
        title: 'Find the Registration Date',
        difficulty: 'easy',
        points: 5,
        desc: 'When was the domain first registered?',
      },
      {
        id: 'q3-expires',
        title: 'Find the Expiration Date',
        difficulty: 'easy',
        points: 5,
        desc: 'When does the registration expire?',
      },
      {
        id: 'q4-nameservers',
        title: 'Find the Nameservers',
        difficulty: 'medium',
        points: 10,
        desc: 'What nameservers does the domain use? What does this tell you about the hosting infrastructure?',
        hints: [
          { text: 'The nameservers tell you what CDN or hosting provider the domain uses.', cost: 2 },
        ],
      },
      {
        id: 'q5-a-record',
        title: "Find the A Record",
        difficulty: 'easy',
        points: 5,
        gradingMode: 'manual',
        desc: 'What is the A record (IP address) for ungcyberunit.org? (`dig A ungcyberunit.org` or nslookup — this can change, so it\'s reviewed rather than auto-checked.)',
      },
      {
        id: 'q6-mx-record',
        title: 'Find the MX Records',
        difficulty: 'easy',
        points: 5,
        gradingMode: 'manual',
        desc: 'Are there MX records (mail servers)? If so, what service handles email? (`dig MX ungcyberunit.org`)',
      },
      {
        id: 'q7-txt-record',
        title: 'Find the TXT Records',
        difficulty: 'easy',
        points: 5,
        gradingMode: 'manual',
        desc: 'Are there any TXT records? What can you learn from them (SPF policy, domain verification, etc.)? (`dig TXT ungcyberunit.org`)',
      },
      {
        id: 'q8-subdomains',
        title: 'Discover Subdomains',
        difficulty: 'medium',
        points: 10,
        gradingMode: 'manual',
        desc: 'Try common prefixes (www, mail, blog, api, old, dev) against ungcyberunit.org. Which ones resolve?',
        hints: [
          { text: 'If WHOIS shows "REDACTED FOR PRIVACY," that\'s a finding in itself — note it.', cost: 2 },
        ],
      },
    ],
    ethicsNotice: false,
  },
  {
    id: 'osint-web-archaeology',
    title: 'Web Archaeology',
    category: 'OSINT',
    difficulty: 'Advanced',
    // Deliberately the lab's culminating challenge: highest point value,
    // highest difficulty, and last in both ctfModules order (drives the
    // hub grid and prev/next nav) and the /labs/osint hub's own card order.
    shortDesc: "The OSINT lab's capstone — dig through a real, still-live 1999-era personal website for details its author never meant to leave exposed.",
    pageUrl: '/labs/osint/web-archaeology',
    target: {
      url: 'https://blog.acklenx.com',
      label: 'blog.acklenx.com',
      desc: 'Start here, then find the link to the "old" 1999 site in the top navigation',
      icon: '🗄️',
    },
    toolbox: [
      { name: 'View Page Source (Ctrl+U)', desc: 'Raw HTML, including anything left behind in <meta> tags that never renders on the page itself — essential for this challenge.' },
    ],
    briefing: {
      sections: [
        {
          heading: 'Situation',
          body: "This is the lab's final and most involved challenge — it draws on the same instincts as the first three (reading between the lines, checking everywhere information might hide) and asks for more of it. People have been putting personal information online since the mid-1990s. Old personal sites were hand-built in raw HTML and often include details an author would never post today. Your target is a real 1999-era personal website that is still live — start at blog.acklenx.com, find the \"old\" site link in the nav, and explore every page, reading the HTML source as you go.",
        },
      ],
    },
    parts: [
      { id: 'q1-author-name', title: "Find the Author's Name", difficulty: 'easy', points: 5, desc: "What is the site author's full name?" },
      {
        id: 'q2-meta-email', title: 'Find the Meta-Tag Email', difficulty: 'medium', points: 10,
        desc: 'What email address is listed in the HTML meta tags of the main 1999 page? (View Page Source.)',
        hints: [{ text: 'The <meta> tags in the <head> contain email, keywords, and editor info not visible on the rendered page.', cost: 2 }],
      },
      { id: 'q3-html-editor', title: 'Find the HTML Editor', difficulty: 'easy', points: 5, desc: 'What HTML editor was used to build the site? (Check the meta tags.)' },
      { id: 'q4-military-branch', title: 'Find the Military Branch', difficulty: 'easy', points: 5, desc: "What branch of the U.S. military did the author serve in?" },
      {
        id: 'q5-home-address', title: "Find the Resume Address", difficulty: 'medium', points: 10,
        desc: "What was the author's home address (street, city, state, ZIP) per the resume page?",
        hints: [{ text: "The resume page has the most sensitive information — address, phone, employment history.", cost: 2 }],
      },
      { id: 'q6-places-lived', title: 'Find Places Lived', difficulty: 'medium', points: 10, gradingMode: 'manual', desc: "List three states or countries where the author has lived." },
      { id: 'q7-favorite-book', title: 'Find the Favorite Book', difficulty: 'easy', points: 5, desc: "What is the author's favorite book, and who wrote it?" },
      { id: 'q8-favorite-movie', title: 'Find the Favorite Movie', difficulty: 'easy', points: 5, desc: "What is the author's favorite movie — specifically, the one made in 1992?" },
      { id: 'q9-hobbies', title: 'Find Two Unexpected Hobbies', difficulty: 'easy', points: 5, gradingMode: 'manual', desc: "Name two hobbies from the site that you wouldn't expect." },
      {
        id: 'q10-phone-bonus', title: 'BONUS: Decode the Phone Number', difficulty: 'hard', points: 15, gradingMode: 'manual',
        desc: 'What phone number appears on the resume? What area code is it, and what region does that area code cover?',
        hints: [{ text: 'For the area-code lookup, just search the area code itself.', cost: 2 }],
      },
    ],
    ethicsNotice: false,
  },
];

// SEO meta block for a generic (new-style) CTF module page, same shape as
// topicMetaTags() — see that function for the escaping/breadcrumb rationale.
export function challengeModuleMetaTags(m) {
  const title = escapeHtml(`${m.title} — UNG Cyber Unit`);
  const desc = escapeHtml(`${m.shortDesc} A CTF-style cybersecurity challenge from the UNG Cyber Unit.`);
  const canonical = `https://ungcyberunit.org${m.pageUrl}`;
  const image = 'https://ungcyberunit.org/images/CyberUnitLogo_Transparent.png';
  // The OSINT lab's modules live under their own hub (/labs/osint), not the
  // main CTF Challenges hub, so their breadcrumb's second step differs.
  const hub = m.pageUrl.startsWith('/labs/osint/')
    ? { name: 'Introduction to OSINT', item: 'https://ungcyberunit.org/labs/osint' }
    : { name: 'CTF Challenges', item: 'https://ungcyberunit.org/challenges' };
  const breadcrumb = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://ungcyberunit.org/' },
      { '@type': 'ListItem', position: 2, name: hub.name, item: hub.item },
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

  const parts = (m.parts ?? []).map((p, i) => {
    const hints = (p.hints ?? []).map((h, hi) => `
            <div class="lac-hint" data-hint-index="${hi}" data-hint-cost="${h.cost ?? DEFAULT_HINT_COST}">
              <button type="button" class="lac-hint-toggle">Hint ${hi + 1} (-${h.cost ?? DEFAULT_HINT_COST} pts)</button>
              <p class="lac-hint-body" hidden></p>
            </div>`).join('');

    const submit = p.gradingMode === 'manual' ? `
          <div class="lac-submit lac-submit--manual">
            <form class="lac-answer-form">
              <input type="text" class="lac-answer-input" placeholder="Your answer" aria-label="Your answer" autocomplete="off" maxlength="200">
              <button type="submit" class="btn btn-sm">Save</button>
            </form>
            <p class="lac-answer-feedback" hidden></p>
          </div>` : `
          <div class="lac-submit">
            <form class="lac-answer-form">
              <input type="text" class="lac-answer-input" placeholder="Your flag" aria-label="Your answer" autocomplete="off" maxlength="200">
              <button type="submit" class="btn btn-sm">Submit</button>
            </form>
            <p class="lac-answer-feedback" hidden></p>
          </div>`;

    return `
        <div class="card lac-challenge" data-part-id="${escapeHtml(p.id)}" data-grading-mode="${p.gradingMode === 'manual' ? 'manual' : 'auto'}" data-points="${p.points ?? 0}">
          <div class="lac-challenge-head">
            <span class="lac-challenge-num">${String(i + 1).padStart(2, '0')}</span>
            <span class="lac-difficulty lac-difficulty--${escapeHtml(p.difficulty ?? 'easy')}">${escapeHtml((p.difficulty ?? 'easy').replace('-', ' '))}</span>
            ${p.points != null ? `<span class="lac-points">${p.points} pts</span>` : ''}
          </div>
          <h3 class="lac-challenge-title">${escapeHtml(p.title)}</h3>
          <p class="lac-challenge-desc">${escapeHtml(p.desc)}</p>
          ${p.targetFile ? `<span class="lac-target-file"><span class="lac-target-label">Target file:</span> <span class="lac-target-name">${escapeHtml(p.targetFile)}</span></span>` : ''}
          ${hints ? `<div class="lac-hints">${hints}</div>` : ''}
          ${p.gradingMode === 'manual' ? `<p class="lac-manual-note">This answer will be reviewed by an instructor.</p>` : ''}
          ${submit}
        </div>`;
  }).join('');

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

  // Image galleries (e.g. the OSINT reverse-image-search challenge) — the
  // files themselves are a manual TODO (see Implementation Guide.md: can't
  // source/host copyrighted landmark photos here), so this renders the slot
  // and caption now; a broken-image icon is expected until the real files
  // land at /assets/labs/osint/images/.
  const imagesSection = (m.images?.length) ? `
      <section class="instructor-section">
        <h2 class="instructor-section-heading">// Images</h2>
        <div class="lac-image-gallery">
          ${m.images.map((img, i) => `
          <figure class="card lac-image-card">
            <img src="/assets/labs/osint/images/${escapeHtml(img.filename)}" alt="${escapeHtml(img.caption ?? `Image ${i + 1}`)}" loading="lazy">
            <figcaption>${escapeHtml(img.caption ?? `Image ${i + 1}`)}</figcaption>
          </figure>`).join('')}
        </div>
      </section>` : '';

  const maxPoints = (m.parts ?? []).reduce((sum, p) => sum + (typeof p === 'string' ? 0 : (p.points ?? 0)), 0);

  return `
      <header style="margin-bottom: 1.5rem;">
        <h1>// ${escapeHtml(m.title)}</h1>
        <p style="color: var(--text-muted); font-family: 'Share Tech Mono', monospace; font-size: 0.85rem; margin: 0.4rem 0 0;">
          ${escapeHtml(m.shortDesc ?? '')}
        </p>
        <p style="margin: 0.5rem 0 0;">
          <span class="badge badge-${m.difficulty.toLowerCase()}">${escapeHtml(m.difficulty)}</span>
          ${maxPoints > 0 ? `<span class="lac-points lac-points--header">${maxPoints} points</span>` : ''}
        </p>
      </header>

      ${ethics}
      ${targetSection}
      ${downloadsSection}
      ${imagesSection}

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
// The OSINT lab's 4 modules cycle only among themselves (back to /labs/osint,
// not the main CTF hub) since they're a separate lab, not part of that list;
// every other module cycles through the full ctfModules order, the same
// order the /challenges hub lists them in.
export function challengeModuleNavHtml(currentId) {
  const inOsintLab = osintModules.some(m => m.id === currentId);
  const list = inOsintLab ? osintModules : ctfModules;
  const hubUrl = inOsintLab ? '/labs/osint' : '/challenges';
  const hubLabel = inOsintLab ? 'OSINT Lab' : 'All Challenges';

  const idx = list.findIndex(m => m.id === currentId);
  if (idx === -1) return '';
  const prev = list[(idx - 1 + list.length) % list.length];
  const next = list[(idx + 1) % list.length];
  return `
      <nav class="lac-module-nav" aria-label="Other CTF challenges">
        <a href="${prev.pageUrl}" class="lac-module-nav-link lac-module-nav-link--prev">
          <span class="lac-module-nav-arrow" aria-hidden="true">←</span>
          <span class="lac-module-nav-text"><span class="lac-module-nav-label">Previous</span>${escapeHtml(prev.title)}</span>
        </a>
        <a href="${hubUrl}" class="lac-module-nav-hub">${hubLabel}</a>
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
  const maxPoints = m.parts.reduce((sum, p) => sum + (typeof p === 'string' ? 0 : (p.points ?? 0)), 0);
  return `<a href="${m.pageUrl}" class="card card-link" data-challenge="${m.id}" data-total-parts="${m.parts.length}" data-max-points="${maxPoints}" aria-label="${title}">
          <h3 class="card-title">${title}</h3>
          <p class="card-desc">${escapeHtml(m.shortDesc ?? '')}</p>
          <div class="card-footer">
            <span class="badge badge-${m.difficulty.toLowerCase()}">${escapeHtml(m.difficulty)}</span>
            <span class="card-desc" style="margin:0;">${escapeHtml(m.category)}</span>
          </div>
        </a>`;
}

// The OSINT lab has its own dedicated hub (/labs/osint, see osintLabCards()
// below) — excluded here so its 4 modules aren't double-listed on the main
// /challenges hub too.
export const osintModules = ctfModules.filter(m => m.category === 'OSINT');

// Server-rendered hub grid so crawlers/no-JS users see every module without
// depending on a client-side fetch — same philosophy as homeTopicCards().
export function challengesHubCards() {
  return ctfModules.filter(m => m.category !== 'OSINT').map(challengeCard).join('\n        ');
}

// The 4-module OSINT lab grid for /labs/osint — same card/progress machinery
// as the main /challenges hub, just filtered to the 'OSINT' category instead
// of listing every module.
export function osintLabCards() {
  return osintModules.map(challengeCard).join('\n        ');
}

export const CHALLENGE_PARTS = Object.fromEntries(
  ctfModules.map(m => [m.id, m.parts.map(p => (typeof p === 'string' ? p : p.id))])
);

// Difficulty-weighted point value per challenge part, used only by the CTF
// leaderboard endpoints below (challenge_completions has no score column of
// its own, unlike quiz_results/quiz_room_attempts, so points are computed
// here rather than summed in SQL). Legacy modules' parts are plain id
// strings with no difficulty annotation — they default to the easy tier.
// A part may instead set an explicit `points` value (the OSINT lab's
// per-question point values don't line up with the three-tier scheme) —
// that always wins over the difficulty-tier default.
const PART_DIFFICULTY_POINTS = { easy: 10, medium: 20, hard: 30 };
export const CHALLENGE_PART_POINTS = Object.fromEntries(
  ctfModules.map(m => [
    m.id,
    Object.fromEntries(m.parts.map(p => [
      typeof p === 'string' ? p : p.id,
      typeof p === 'string'
        ? PART_DIFFICULTY_POINTS.easy
        : p.points ?? PART_DIFFICULTY_POINTS[p.difficulty ?? 'easy'] ?? PART_DIFFICULTY_POINTS.easy,
    ])),
  ])
);

// Default point deduction for revealing one hint (OSINT lab, see POST
// /api/challenges/:id/hints/reveal) — a part's own hint can override this
// per-hint via its `cost` field.
export const DEFAULT_HINT_COST = 2;
