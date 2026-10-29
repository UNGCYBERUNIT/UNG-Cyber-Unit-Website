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

  // ─── OSINT Lab (1 composite module, 1 card on /challenges) ────────────────
  // See Implementation Guide.md (repo root, untracked — contains real PII for
  // the Web Archaeology section, never commit it). One module/one page/one
  // "OSINT" card, same as every other multi-part module here (e.g. "Breach
  // the Portal") — `sections` groups its ~18 parts into the 4 sub-challenges
  // for display (renderChallengeModule), while `parts` stays the flat list
  // CHALLENGE_PARTS/CHALLENGE_PART_POINTS/progress/leaderboard endpoints
  // already expect from every module, composite or not.
  (() => {
    const sections = [
      {
        title: 'Reverse Image Search',
        // Screenshots, so no embedded EXIF to begin with (confirmed with
        // exiftool) — filenames are deliberately generic per the original
        // guide's own instruction, so they don't give away the answer.
        images: [
          { filename: 'landmark-01.png', caption: 'Image 1' },
          { filename: 'landmark-02.png', caption: 'Image 2' },
        ],
        briefing: {
          sections: [
            {
              heading: 'Situation',
              body: 'Two images, one question each: name the landmark.',
            },
          ],
        },
        // One question per image (not a generic "the photo" location/landmark
        // pair) — with exactly 2 images provided, each needs its own correct
        // answer, so each gets its own part. Tool-comparison/source-URL/EXIF
        // questions from the original spec were dropped entirely rather than
        // shrunk, since all three only made sense as instructor-reviewed free
        // text anyway. No hints/toolbox — a CTF shouldn't hand out either.
        parts: [
          {
            id: 'ri-q1-image-one',
            title: 'Identify Image 1',
            difficulty: 'medium',
            points: 15,
            desc: 'Name the landmark in Image 1 and where it is.',
          },
          {
            id: 'ri-q2-image-two',
            title: 'Identify Image 2',
            difficulty: 'medium',
            points: 15,
            desc: 'Name the monument in Image 2 and what it honors.',
          },
        ],
      },
      {
        title: 'Geocoding',
        briefing: {
          sections: [
            {
              heading: 'Situation',
              body: 'Two tips below each name a real UNG Dahlonega building — but only in a three-word phrase. Figure out what kind of code that phrase is and where it points.',
            },
          ],
        },
        // The service these phrases decode with (what3words) is deliberately
        // never named anywhere on this page — the three words are embedded in
        // plain prose, not shown as a "///word.word.word" address or paired
        // with a "visit this site" toolbox tip, so recognizing the format at
        // all is part of the challenge. Both phrases supplied and verified by
        // Joshua directly (not guide placeholders).
        parts: [
          {
            id: 'w3w-q1-dining-hall',
            title: 'Decode the First Tip',
            difficulty: 'easy',
            points: 15,
            desc: 'An anonymous note gives a location only as "**stepfather animates astonish**." Name this UNG building and its common nickname.',
          },
          {
            id: 'w3w-q2-cottrell-center',
            title: 'Decode the Second Tip',
            difficulty: 'easy',
            points: 15,
            desc: 'A second note reads "**unfortunately airship subscribers**." Name this UNG building and what it houses.',
          },
        ],
      },
      {
        title: 'WHOIS / DNS Reconnaissance',
        briefing: {
          sections: [
            {
              heading: 'Situation',
              body: "Map the club's own real domain, ungcyberunit.org, via WHOIS and DNS.",
            },
          ],
        },
        // NOTE: WHOIS/DNS values below are current as of Implementation
        // Guide.md's writing (2026-10-29) — manual TODO: re-verify with `whois`/
        // `dig` before each semester's lab, since expiration/IP/MX data drifts.
        parts: [
          {
            id: 'wd-q1-registrar',
            title: 'Find the Registrar',
            difficulty: 'easy',
            points: 5,
            desc: 'Who is the registrar for ungcyberunit.org?',
          },
          {
            id: 'wd-q2-created',
            title: 'Find the Registration Date',
            difficulty: 'easy',
            points: 5,
            desc: 'When was the domain first registered?',
          },
          {
            id: 'wd-q3-expires',
            title: 'Find the Expiration Date',
            difficulty: 'easy',
            points: 5,
            desc: 'When does the registration expire?',
          },
          {
            id: 'wd-q4-nameservers',
            title: 'Find the Nameservers',
            difficulty: 'medium',
            points: 10,
            desc: 'What nameservers does the domain use? What does this tell you about the hosting infrastructure?',
          },
          {
            id: 'wd-q5-a-record',
            title: "Find the A Record",
            difficulty: 'easy',
            points: 5,
            gradingMode: 'manual',
            desc: 'What is the A record (IP address) for ungcyberunit.org? (`dig A ungcyberunit.org` or nslookup — this can change, so it\'s reviewed rather than auto-checked.)',
          },
          {
            id: 'wd-q6-mx-record',
            title: 'Find the MX Records',
            difficulty: 'easy',
            points: 5,
            gradingMode: 'manual',
            desc: 'Are there MX records (mail servers)? If so, what service handles email? (`dig MX ungcyberunit.org`)',
          },
          {
            id: 'wd-q7-txt-record',
            title: 'Find the TXT Records',
            difficulty: 'easy',
            points: 5,
            gradingMode: 'manual',
            desc: 'Are there any TXT records? What can you learn from them (SPF policy, domain verification, etc.)? (`dig TXT ungcyberunit.org`)',
          },
          {
            id: 'wd-q8-subdomains',
            title: 'Discover Subdomains',
            difficulty: 'medium',
            points: 10,
            gradingMode: 'manual',
            desc: 'Try common prefixes (www, mail, blog, api, old, dev) against ungcyberunit.org. Which ones resolve?',
          },
        ],
      },
      {
        // Deliberately the lab's culminating section: highest point value,
        // highest difficulty, and last in order — it draws on the same
        // instincts as the first three and asks for more of it.
        title: 'Web Archaeology (Capstone)',
        target: {
          url: 'https://blog.acklenx.com',
          label: 'blog.acklenx.com',
          desc: 'Start here, then find the link to the "old" 1999 site in the top navigation',
          icon: '🗄️',
        },
        briefing: {
          sections: [
            {
              heading: 'Situation',
              body: "A real, still-live 1999 personal site. Start at blog.acklenx.com, find the \"old\" site link, and explore.",
            },
          ],
        },
        parts: [
          { id: 'wa-q1-author-name', title: "Find the Author's Name", difficulty: 'easy', points: 5, desc: "What is the site author's full name?" },
          {
            id: 'wa-q2-meta-email', title: 'Find the Meta-Tag Email', difficulty: 'medium', points: 10,
            desc: 'What email address is listed in the HTML meta tags of the main 1999 page? (View Page Source.)',
          },
          { id: 'wa-q3-html-editor', title: 'Find the HTML Editor', difficulty: 'easy', points: 5, desc: 'What HTML editor was used to build the site? (Check the meta tags.)' },
          { id: 'wa-q4-military-branch', title: 'Find the Military Branch', difficulty: 'easy', points: 5, desc: "What branch of the U.S. military did the author serve in?" },
          {
            id: 'wa-q5-home-address', title: "Find the Resume Address", difficulty: 'medium', points: 10,
            desc: "What was the author's home address (street, city, state, ZIP) per the resume page?",
          },
          { id: 'wa-q6-places-lived', title: 'Find Places Lived', difficulty: 'medium', points: 10, gradingMode: 'manual', desc: "List three states or countries where the author has lived." },
          { id: 'wa-q7-favorite-book', title: 'Find the Favorite Book', difficulty: 'easy', points: 5, desc: "What is the author's favorite book, and who wrote it?" },
          { id: 'wa-q8-favorite-movie', title: 'Find the Favorite Movie', difficulty: 'easy', points: 5, desc: "What is the author's favorite movie — specifically, the one made in 1992?" },
          { id: 'wa-q9-hobbies', title: 'Find Two Unexpected Hobbies', difficulty: 'easy', points: 5, gradingMode: 'manual', desc: "Name two hobbies from the site that you wouldn't expect." },
          {
            id: 'wa-q10-phone-bonus', title: 'BONUS: Decode the Phone Number', difficulty: 'hard', points: 15, gradingMode: 'manual',
            desc: 'What phone number appears on the resume? What area code is it, and what region does that area code cover?',
          },
        ],
      },
    ];

    return {
      id: 'osint',
      title: 'Introduction to OSINT',
      category: 'OSINT',
      difficulty: 'Intermediate',
      shortDesc: 'Four open-source intelligence challenges in one: reverse image search, geocoding, WHOIS/DNS recon, and a Web Archaeology capstone.',
      pageUrl: '/challenges/osint',
      sections,
      parts: sections.flatMap(s => s.parts),
      ethicsNotice: false,
    };
  })(),
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

// A `**word word**` span inside a part's `desc` renders bold — the only
// markup a challenge description can carry (e.g. the Geocoding section
// embeds a three-word phrase this way instead of showing a raw
// "///word.word.word" address). Escapes the whole string first, so the
// `**...**` markers are matched against already-safe text; nothing here
// introduces a new way to inject HTML.
function renderDesc(desc) {
  return escapeHtml(desc ?? '').replace(/\*\*(.+?)\*\*/g, '<strong class="lac-desc-highlight">$1</strong>');
}

// One challenge-part card (the submit form, points pill, etc.) — extracted
// so a composite module (OSINT: one page, 4 sub-challenge sections) can
// render several independently-numbered part lists, one per section,
// instead of a single flat list.
function renderPartsList(parts) {
  return (parts ?? []).map((p, i) => {
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
          <p class="lac-challenge-desc">${renderDesc(p.desc)}</p>
          ${p.targetFile ? `<span class="lac-target-file"><span class="lac-target-label">Target file:</span> <span class="lac-target-name">${escapeHtml(p.targetFile)}</span></span>` : ''}
          ${p.gradingMode === 'manual' ? `<p class="lac-manual-note">This answer will be reviewed by an instructor.</p>` : ''}
          ${submit}
        </div>`;
  }).join('');
}

// Downloads/toolbox/briefing/target/images/parts for one "section" of
// content — a whole legacy module (single-section), or one sub-challenge of
// a composite module like OSINT (one page, several sections). `includeSummary`
// places the shared #challengeProgressSummary span inline here (legacy,
// single-section pages) — composite pages place exactly one of these at the
// page level instead, since the id must be unique and the score spans every
// section, not just one.
function renderSectionBody(s, { includeSummary = true } = {}) {
  const downloads = (s.downloads ?? []).map(d => `
          <a class="card lac-download-card" href="/challenges/${s.moduleId}/${d.filename}" download>
            <span class="lac-download-icon" aria-hidden="true">${d.icon ?? '📁'}</span>
            <span class="lac-download-name">${escapeHtml(d.label)}</span>
            <span class="lac-download-desc">${escapeHtml(d.desc)}</span>
          </a>`).join('');

  const toolbox = (s.toolbox ?? []).map(t => `
          <div class="card lac-tool">
            <span class="lac-tool-name">${escapeHtml(t.name)}</span>
            <span class="lac-tool-desc">${escapeHtml(t.desc)}</span>
          </div>`).join('');

  const briefingHtml = (s.briefing?.sections ?? []).map(sec => `
        <h2 class="instructor-section-heading">// ${escapeHtml(sec.heading)}</h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin: 0.5rem 0 1.5rem;">${escapeHtml(sec.body)}</p>`).join('');

  // Live-target modules (e.g. web exploitation) attack a real running app
  // instead of a downloaded file — no "Download" section for those, a
  // "Target" section with a link to the live app instead.
  const targetSection = s.target ? `
      <section class="instructor-section">
        <h2 class="instructor-section-heading">// Target</h2>
        <div class="lac-downloads">
          <a class="card lac-download-card" href="${s.target.url}" target="_blank" rel="noopener noreferrer">
            <span class="lac-download-icon" aria-hidden="true">${s.target.icon ?? '🎯'}</span>
            <span class="lac-download-name">${escapeHtml(s.target.label)}</span>
            <span class="lac-download-desc">${escapeHtml(s.target.desc)}</span>
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
  const imagesSection = (s.images?.length) ? `
      <section class="instructor-section">
        <h2 class="instructor-section-heading">// Images</h2>
        <div class="lac-image-gallery">
          ${s.images.map((img, i) => `
          <figure class="card lac-image-card">
            <img src="/assets/labs/osint/images/${escapeHtml(img.filename)}" alt="${escapeHtml(img.caption ?? `Image ${i + 1}`)}" loading="lazy">
            <figcaption>${escapeHtml(img.caption ?? `Image ${i + 1}`)}</figcaption>
          </figure>`).join('')}
        </div>
      </section>` : '';

  const parts = renderPartsList(s.parts);

  return `
      ${targetSection}
      ${downloadsSection}
      ${imagesSection}

      ${toolbox ? `<section class="instructor-section">
        <h2 class="instructor-section-heading">// Your Toolbox</h2>
        <div class="lac-toolbox">${toolbox}</div>
      </section>` : ''}

      ${briefingHtml ? `<section class="instructor-section">${briefingHtml}</section>` : ''}

      <section class="instructor-section">
        <h2 class="instructor-section-heading">// The Challenge${(s.parts?.length ?? 0) > 1 ? 's' : ''}</h2>
        ${includeSummary ? `<p style="color: var(--text-muted); font-size: 0.9rem; margin: 0.5rem 0 1rem;">
          <span id="challengeProgressSummary" class="lac-progress-summary" hidden></span>
        </p>` : ''}
        ${parts}
      </section>`;
}

// Full server-rendered body content for a generic CTF module page — briefing,
// downloads, toolbox, challenge parts, optional ethics notice. Injected into
// public/challenge-module.html's placeholder by the /challenges/:id route.
// No client re-render needed (unlike topics): this content is fully static
// per module, main.js only layers on progress/submit behavior afterward.
//
// Two shapes: a plain module (toolbox/briefing/parts/etc. at the top level,
// one "// The Challenges" block — every existing module) or a composite one
// with `m.sections` (OSINT: one page, one card on /challenges, but a
// separate titled section — own briefing/toolbox/parts — per sub-challenge).
// `m.parts` always stays the full flattened list either way (set directly on
// composite modules, same as any other), so CHALLENGE_PARTS/
// CHALLENGE_PART_POINTS/the leaderboard/progress endpoints need no awareness
// of sections at all — only this renderer does.
export function renderChallengeModule(m) {
  const ethics = m.ethicsNotice ? `
      <div class="card lac-ethics" style="margin-bottom: 2rem;">
        <strong>Stay in scope.</strong> Every artifact here is synthetic — built for this
        challenge, not captured from a real system. Apply the same techniques
        only against systems you own or are explicitly authorized to test.
      </div>` : '';

  const maxPoints = (m.parts ?? []).reduce((sum, p) => sum + (typeof p === 'string' ? 0 : (p.points ?? 0)), 0);

  const body = m.sections
    ? [
        `<section class="instructor-section">
          <p style="color: var(--text-muted); font-size: 0.9rem; margin: 0;">
            <span id="challengeProgressSummary" class="lac-progress-summary" hidden></span>
          </p>
        </section>`,
        ...m.sections.map((s, i) => `
      <details class="instructor-section lac-module-section"${i === 0 ? ' open' : ''}>
        <summary class="lac-module-section-heading">
          <span>${i + 1}. ${escapeHtml(s.title)}</span>
          <span class="lac-module-section-arrow" aria-hidden="true">▾</span>
        </summary>
        <div class="lac-module-section-body">
          ${s.intro ? `<p style="color: var(--text-muted); font-size: 0.9rem; margin: 0.25rem 0 1rem;">${escapeHtml(s.intro)}</p>` : ''}
          ${renderSectionBody({ ...s, moduleId: m.id }, { includeSummary: false })}
        </div>
      </details>`),
      ].join('\n')
    : renderSectionBody({ ...m, moduleId: m.id });

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
      ${body}

      <section class="instructor-section" id="answerKeySection" hidden>
        <h2 class="instructor-section-heading">// Instructor Answer Key</h2>
        <a class="btn btn-sm" href="/api/challenges/${m.id}/answer-key">Download Answer Key</a>
      </section>

      <section class="instructor-section" id="submissionLogSection" hidden>
        <h2 class="instructor-section-heading">// Submission Log</h2>
        <div id="submissionLogTableWrap"></div>
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
