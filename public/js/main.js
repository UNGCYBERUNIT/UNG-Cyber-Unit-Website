/* ============================================================
   CyberUnit @ UNG — main.js
   Client-side logic for homepage and topic pages
   ============================================================ */

'use strict';

import { renderContent, getTopicSVG } from './topic-render.js';

// ─── Auth State ───────────────────────────────────────────────────────────────

let currentUser = null; // { username, role, avatar } or null

const DEFAULT_AVATAR = '/images/CyberUnitLogo_Transparent.png';

// ─── Utility ──────────────────────────────────────────────────────────────────

function getTopicIdFromURL() {
  const parts = window.location.pathname.split('/');
  return parts[parts.length - 1];
}

function isHomePage() {
  return window.location.pathname === '/' || window.location.pathname === '/index.html';
}

// ─── Navbar Hamburger ─────────────────────────────────────────────────────────

// ─── Scroll Perf ──────────────────────────────────────────────────────────────

// See the body.is-scrolling rule in style.css for why this exists.
function initScrollPerf() {
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    document.body.classList.add('is-scrolling');
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => document.body.classList.remove('is-scrolling'), 150);
  }, { passive: true });
}

function initHamburger() {
  const btn   = document.getElementById('hamburger');
  const links = document.getElementById('navLinks');
  if (!btn || !links) return;

  btn.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !links.contains(e.target)) {
      links.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

// ─── Typewriter Effect ────────────────────────────────────────────────────────

function initTypewriter() {
  const el = document.getElementById('typewriterText');
  if (!el) return;

  // Text is server-rendered into the span (see index.html); re-type it for the
  // animation so crawlers and no-JS users still see the full heading.
  const text = el.textContent.trim() || 'Learn Cybersecurity. One Concept at a Time.';
  el.textContent = '';
  let i = 0;

  function type() {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(type, 55);
    }
  }
  setTimeout(type, 400);
}

// ─── Smooth Scroll ────────────────────────────────────────────────────────────

function initSmoothScroll() {
  document.querySelectorAll('a[href^="/#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').split('#')[1];
      const el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

// ─── Homepage: Render Topic Grid ──────────────────────────────────────────────

// Cached after the initial fetch so the difficulty filter can re-render
// client-side without another round-trip.
let homeTopics = null;
let homeProgressMap = null;

function topicGridCardHtml(t, progressMap) {
  const prog = progressMap[t.id];
  const progressBadge = prog
    ? `<div class="card-progress" aria-label="Quiz score: ${prog.score} of ${prog.total}">
         ${prog.score}/${prog.total}${prog.score === prog.total ? ' <span class="progress-star" aria-hidden="true">★</span>' : ''}
       </div>`
    : '';
  return `
    <a href="/topic/${t.id}" class="card card-link${prog ? ' card-completed' : ''}" aria-label="${escHtml(t.title)}">
      ${progressBadge}
      <div class="card-icon" aria-hidden="true">${t.icon}</div>
      <h3 class="card-title">${escHtml(t.title)}</h3>
      <p class="card-desc">${escHtml(t.shortDesc)}</p>
      <div class="card-footer">
        <span class="badge badge-${t.difficulty.toLowerCase()}">${escHtml(t.difficulty)}</span>
        <span class="btn btn-sm" aria-hidden="true">Explore →</span>
      </div>
    </a>`;
}

function renderFilteredTopicGrid(difficulty) {
  const grid = document.getElementById('topicGrid');
  if (!grid || !homeTopics) return;
  const filtered = difficulty
    ? homeTopics.filter(t => t.difficulty.toLowerCase() === difficulty)
    : homeTopics;
  grid.innerHTML = filtered.length
    ? filtered.map(t => topicGridCardHtml(t, homeProgressMap)).join('')
    : '<p style="color:var(--text-muted);font-family:\'Share Tech Mono\',monospace;">No topics match this filter yet.</p>';
}

function initDifficultyFilter() {
  const bar = document.getElementById('difficultyFilter');
  if (!bar) return;

  const initial = new URLSearchParams(window.location.search).get('difficulty') || '';
  for (const chip of bar.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.difficulty === initial));
  }
  if (initial) renderFilteredTopicGrid(initial);

  bar.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const difficulty = chip.dataset.difficulty;

    for (const c of bar.querySelectorAll('.chip')) {
      c.setAttribute('aria-pressed', String(c === chip));
    }
    renderFilteredTopicGrid(difficulty);

    const params = new URLSearchParams(window.location.search);
    if (difficulty) params.set('difficulty', difficulty);
    else params.delete('difficulty');
    const query = params.toString();
    history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  });
}

async function renderTopicGrid() {
  const grid = document.getElementById('topicGrid');
  if (!grid) return;

  try {
    const [topicsRes, progressRes] = await Promise.all([
      fetch('/api/topics'),
      fetch('/api/progress'),
    ]);
    const topics = await topicsRes.json();
    const { results: progressList } = progressRes.ok ? await progressRes.json() : { results: [] };

    const progressMap = {};
    for (const r of (progressList ?? [])) progressMap[r.topic_id] = r;

    homeTopics = topics;
    homeProgressMap = progressMap;

    // Update dynamic stats bar
    const statTopics  = document.getElementById('statTopics');
    const statQuizzes = document.getElementById('statQuizzes');
    if (statTopics)  statTopics.textContent  = topics.length;
    if (statQuizzes) statQuizzes.textContent = topics.length;

    const activeDifficulty = new URLSearchParams(window.location.search).get('difficulty') || '';
    renderFilteredTopicGrid(activeDifficulty);
  } catch (err) {
    // The grid is server-rendered, so only show an error if it's actually empty
    // (never wipe the server-rendered cards when the progress fetch fails).
    if (!grid.querySelector('.card')) {
      grid.innerHTML = '<p style="color:var(--danger);font-family:\'Share Tech Mono\',monospace;">Failed to load topics.</p>';
    }
  }
}

// ─── Topic Page: Load & Render ────────────────────────────────────────────────

async function renderTopicPage() {
  const id = getTopicIdFromURL();

  try {
    const [topicRes, allRes, progressRes] = await Promise.all([
      fetch(`/api/topic/${id}`),
      fetch('/api/topics'),
      fetch('/api/progress'),
    ]);

    if (!topicRes.ok) {
      document.getElementById('topicContent').innerHTML =
        '<p style="color:var(--danger);">Topic not found.</p>';
      return;
    }

    const topic  = await topicRes.json();
    const topics = await allRes.json();
    const { results: progressList } = progressRes.ok ? await progressRes.json() : { results: [] };
    const prevResult = (progressList ?? []).find(r => r.topic_id === id);

    // Update <title>
    document.title = `CyberUnit @ UNG — ${topic.title}`;

    // Breadcrumb
    document.getElementById('breadcrumbTopic').textContent = topic.title;

    // Header
    document.getElementById('topicIcon').textContent  = topic.icon;
    document.getElementById('topicTitle').textContent = topic.title;
    const badge = document.getElementById('topicDifficulty');
    badge.textContent = topic.difficulty;
    badge.className   = `badge badge-${topic.difficulty.toLowerCase()}`;
    document.getElementById('topicReadTime').textContent = topic.readTime;

    const cheatSheetLink = document.getElementById('cheatSheetLink');
    if (cheatSheetLink) {
      if (topic.hasCheatSheet) {
        cheatSheetLink.href = `/cheatsheet/${topic.id}`;
        cheatSheetLink.hidden = false;
      } else {
        cheatSheetLink.hidden = true;
      }
    }

    // Illustration (inline SVG)
    document.getElementById('topicIllustration').innerHTML = getTopicSVG(topic.id, topic.icon, topic.title);

    // Content
    document.getElementById('topicContent').innerHTML = renderContent(topic);

    // Quiz
    renderQuiz(topic.quiz, topic.id);

    // Previous best score banner
    if (prevResult) {
      const quizSection = document.getElementById('quizSection');
      const heading = quizSection && quizSection.querySelector('h2');
      if (heading) {
        const banner = document.createElement('div');
        banner.id = 'progressBanner';
        banner.className = 'prev-score-banner';
        const perfect = prevResult.score === prevResult.total;
        banner.innerHTML = `
          <span class="prev-score-label">Your best:</span>
          <span class="prev-score-value">${prevResult.score} / ${prevResult.total}</span>
          ${perfect ? '<span class="prev-score-perfect" aria-hidden="true">★ Perfect!</span>' : ''}
        `;
        quizSection.insertBefore(banner, heading);
      }
    }

    // Reset progress button (works on fresh page load, before quiz is attempted)
    const resetBtn = document.getElementById('resetProgressBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        confirmDialog('Reset your saved progress for this topic? This cannot be undone.', () => {
          resetProgress(id, () => {
            const scoreEl = document.getElementById('quizScore');
            if (scoreEl) scoreEl.style.display = 'none';
            renderQuiz(topic.quiz, id);
          });
        });
      });
    }

    // Previous / Next navigation
    renderTopicNav(topics, id);

    // Build table of contents
    buildTOC(topic.fullContent.sections);

    // Wire up interactive demos
    if (topic.id === '03') initPasswordStrength();
    if (topic.id === '06') initCaesarCipher();
    if (topic.id === '07') initHygieneChecklist();

    // Start scroll spy after a tick (lets DOM settle)
    requestAnimationFrame(initScrollSpy);

  } catch (err) {
    document.getElementById('topicContent').innerHTML =
      `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Error loading topic: ${escHtml(err.message)}</p>`;
  }
}

// ─── Demo Logic: Password Strength ───────────────────────────────────────────

function initPasswordStrength() {
  const input    = document.getElementById('pwInput');
  const bar      = document.getElementById('pwProgressBar');
  const label    = document.getElementById('pwStrengthLabel');
  const barWrap  = bar && bar.parentElement;
  if (!input || !bar) return;

  function checkTip(id, pass) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('pass', pass);
    el.classList.toggle('fail', !pass);
    el.textContent = (pass ? '✓ ' : '○ ') + el.textContent.replace(/^[✓○] /, '');
  }

  function evaluate(pw) {
    const hasUpper  = /[A-Z]/.test(pw);
    const hasLower  = /[a-z]/.test(pw);
    const hasNumber = /[0-9]/.test(pw);
    const hasSymbol = /[^A-Za-z0-9]/.test(pw);
    const longEnough = pw.length >= 12;

    checkTip('tip-length', longEnough);
    checkTip('tip-upper',  hasUpper);
    checkTip('tip-lower',  hasLower);
    checkTip('tip-number', hasNumber);
    checkTip('tip-symbol', hasSymbol);

    const score = [longEnough, hasUpper, hasLower, hasNumber, hasSymbol].filter(Boolean).length;
    const pct   = score * 20;

    bar.style.width = pct + '%';
    bar.className   = 'progress-bar';
    if (barWrap) barWrap.setAttribute('aria-valuenow', pct);

    if (score <= 2) {
      bar.classList.add('progress-weak');
      label.textContent = `Strength: Weak`;
      label.style.color = 'var(--danger)';
    } else if (score <= 3) {
      bar.classList.add('progress-fair');
      label.textContent = `Strength: Fair`;
      label.style.color = 'var(--warn)';
    } else {
      bar.classList.add('progress-strong');
      label.textContent = `Strength: Strong`;
      label.style.color = 'var(--accent)';
    }
  }

  input.addEventListener('input', () => evaluate(input.value));
  evaluate(input.value);
}

// ─── Demo Logic: Caesar Cipher ────────────────────────────────────────────────

function caesarShift(text, shift, decode = false) {
  const s = decode ? (26 - shift) % 26 : shift;
  return text.split('').map(ch => {
    if (/[a-z]/.test(ch)) return String.fromCharCode(((ch.charCodeAt(0) - 97 + s) % 26) + 97);
    if (/[A-Z]/.test(ch)) return String.fromCharCode(((ch.charCodeAt(0) - 65 + s) % 26) + 65);
    return ch;
  }).join('');
}

function initCaesarCipher() {
  const input    = document.getElementById('cipherInput');
  const output   = document.getElementById('cipherOutput');
  const slider   = document.getElementById('cipherShift');
  const shiftVal = document.getElementById('cipherShiftVal');
  const encBtn   = document.getElementById('cipherEncodeBtn');
  const decBtn   = document.getElementById('cipherDecodeBtn');
  if (!input || !output || !slider) return;

  function update(decode = false) {
    const shift = parseInt(slider.value, 10);
    shiftVal.textContent = shift;
    output.value = caesarShift(input.value, shift, decode);
  }

  slider.addEventListener('input', () => update(false));
  input.addEventListener('input', () => update(false));
  encBtn.addEventListener('click', () => update(false));
  decBtn.addEventListener('click', () => update(true));
  update(false);
}

// ─── Demo Logic: Hygiene Checklist ───────────────────────────────────────────

function initHygieneChecklist() {
  const list     = document.getElementById('hygieneChecklist');
  const scoreEl  = document.getElementById('hygieneScoreNum');
  if (!list) return;

  const STORAGE_KEY = 'cyberunit-hygiene';
  const total = list.querySelectorAll('li').length;

  // Load saved state
  let checked = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

  function updateScore() {
    if (scoreEl) scoreEl.textContent = checked.length;
  }

  function applyState() {
    list.querySelectorAll('li').forEach(li => {
      const idx = parseInt(li.dataset.index, 10);
      const isChecked = checked.includes(idx);
      li.classList.toggle('checked', isChecked);
      li.setAttribute('aria-checked', isChecked);
    });
    updateScore();
  }

  function toggle(li) {
    const idx = parseInt(li.dataset.index, 10);
    if (checked.includes(idx)) {
      checked = checked.filter(i => i !== idx);
    } else {
      checked.push(idx);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
    applyState();
  }

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => toggle(li));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(li); }
    });
  });

  applyState();
}

// ─── Table of Contents ───────────────────────────────────────────────────────

function buildTOC(sections) {
  const toc = document.getElementById('toc');
  if (!toc) return;

  const items = sections.map((s, i) => `
    <li>
      <a href="#section-${i}" class="toc-link" data-target="section-${i}">
        <span class="toc-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <span class="toc-text">${escHtml(s.heading)}</span>
      </a>
    </li>`).join('');

  const quizItem = `
    <li class="toc-divider-item">
      <a href="#quizSection" class="toc-link toc-quiz" data-target="quizSection">
        <span class="toc-num" aria-hidden="true">✦</span>
        <span class="toc-text">Knowledge Check</span>
      </a>
    </li>`;

  toc.innerHTML = `
    <div class="toc-header">
      <span class="toc-title">// Contents</span>
      <button class="toc-toggle" id="tocToggle" aria-label="Toggle table of contents" aria-expanded="true">
        <span class="toc-toggle-icon" aria-hidden="true">▲</span>
      </button>
    </div>
    <nav aria-label="Section navigation">
      <ul class="toc-list" id="tocList" role="list">
        ${items}
        <li class="toc-sep" role="separator" aria-hidden="true"></li>
        ${quizItem}
      </ul>
    </nav>`;

  // ── Smooth scroll on click ──
  toc.querySelectorAll('.toc-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(link.dataset.target);
      if (!target) return;
      const y = target.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: y, behavior: 'smooth' });
      // Update active immediately on click
      toc.querySelectorAll('.toc-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });

  // ── Mobile toggle ──
  const toggle   = document.getElementById('tocToggle');
  const list     = document.getElementById('tocList');
  const icon     = toggle && toggle.querySelector('.toc-toggle-icon');

  function isMobileLayout() { return window.innerWidth < 1100; }

  function applyInitialCollapse() {
    if (!toggle || !list) return;
    if (isMobileLayout()) {
      list.classList.add('toc-collapsed');
      if (icon) icon.textContent = '▼';
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      list.classList.remove('toc-collapsed');
      if (icon) icon.textContent = '▲';
      toggle.setAttribute('aria-expanded', 'true');
    }
  }

  applyInitialCollapse();
  window.addEventListener('resize', applyInitialCollapse);

  if (toggle && list) {
    toggle.addEventListener('click', () => {
      const collapsed = list.classList.toggle('toc-collapsed');
      if (icon) icon.textContent = collapsed ? '▼' : '▲';
      toggle.setAttribute('aria-expanded', !collapsed);
    });
  }
}

function initScrollSpy() {
  const toc = document.getElementById('toc');
  if (!toc) return;

  const links = toc.querySelectorAll('.toc-link[data-target]');
  if (!links.length) return;

  // Track which section is most visible
  let activeId = null;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const link = toc.querySelector(`.toc-link[data-target="${entry.target.id}"]`);
      if (!link) return;

      if (entry.isIntersecting) {
        // Deactivate all, activate this one
        links.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        activeId = entry.target.id;

        // Keep active link scrolled into view inside the TOC
        if (window.innerWidth >= 1100) {
          link.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    });
  }, {
    // Fire when the top of a section crosses 20% from the top of the viewport
    rootMargin: '-20% 0px -65% 0px',
    threshold: 0,
  });

  links.forEach(link => {
    const target = document.getElementById(link.dataset.target);
    if (target) observer.observe(target);
  });

  // Activate the first link immediately (before any scrolling)
  if (links[0]) links[0].classList.add('active');
}

// ─── Quiz System ──────────────────────────────────────────────────────────────

function renderQuiz(questions, topicId = null) {
  const container = document.getElementById('quizContainer');
  if (!container || !questions) return;

  let answered = 0;
  let correct  = 0;
  const total  = questions.length;
  const selected = new Array(total).fill(-1);

  container.innerHTML = questions.map((q, qi) => `
    <div class="quiz-box" id="quiz-${qi}">
      <p class="quiz-question">${qi + 1}. ${escHtml(q.question)}</p>
      <div class="quiz-options" role="group" aria-label="Answer choices for question ${qi + 1}">
        ${q.answers.map((ans, ai) => `
          <button class="quiz-option"
            data-qi="${qi}" data-ai="${ai}"
            aria-label="Option ${String.fromCharCode(65 + ai)}: ${escHtml(ans)}">
            <strong>${String.fromCharCode(65 + ai)})</strong> ${escHtml(ans)}
          </button>`).join('')}
      </div>
      <div class="quiz-feedback" id="feedback-${qi}" aria-live="polite"></div>
    </div>`).join('');

  container.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const qi  = parseInt(btn.dataset.qi, 10);
      const ai  = parseInt(btn.dataset.ai, 10);
      const q   = questions[qi];
      const box = document.getElementById(`quiz-${qi}`);

      // Disable all options for this question
      box.querySelectorAll('.quiz-option').forEach(b => { b.disabled = true; });

      const isCorrect = ai === q.correct;
      selected[qi] = ai;
      btn.classList.add(isCorrect ? 'correct' : 'wrong');

      if (!isCorrect) {
        box.querySelector(`[data-qi="${qi}"][data-ai="${q.correct}"]`).classList.add('correct');
      }

      const feedback = document.getElementById(`feedback-${qi}`);
      if (feedback) {
        feedback.className  = `quiz-feedback ${isCorrect ? 'correct' : 'wrong'}`;
        feedback.innerHTML  = isCorrect
          ? `✓ Correct! ${escHtml(q.explanation)}`
          : `✗ Not quite. The answer is <strong>${String.fromCharCode(65 + q.correct)}</strong>. ${escHtml(q.explanation)}`;
      }

      answered++;
      if (isCorrect) correct++;

      if (answered === total) showScore();
    });
  });

  function showScore() {
    const scoreEl   = document.getElementById('quizScore');
    const numEl     = document.getElementById('quizScoreNum');
    const msgEl     = document.getElementById('quizScoreMsg');
    const tryAgain  = document.getElementById('tryAgainBtn');
    if (!scoreEl) return;

    numEl.textContent = `You got ${correct} / ${total} correct`;
    if (correct === total) {
      msgEl.textContent = 'Perfect score! 🎉';
      msgEl.style.color = 'var(--accent)';
    } else if (correct >= total - 1) {
      msgEl.textContent = 'Nice work! Review the topic and try again.';
      msgEl.style.color = 'var(--warn)';
    } else {
      msgEl.textContent = 'Keep studying — you\'ve got this!';
      msgEl.style.color = 'var(--text-muted)';
    }
    scoreEl.style.display = 'block';
    scoreEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (topicId) saveProgress(topicId, selected);

    tryAgain.addEventListener('click', () => {
      scoreEl.style.display = 'none';
      answered = 0;
      correct  = 0;
      renderQuiz(questions, topicId);
    }, { once: true });

  }
}

// ─── Topic Navigation ─────────────────────────────────────────────────────────

function renderTopicNav(topics, currentId) {
  const idx   = topics.findIndex(t => t.id === currentId);
  const prev  = topics[idx - 1];
  const next  = topics[idx + 1];

  const prevEl = document.getElementById('prevLink');
  const nextEl = document.getElementById('nextLink');

  if (prevEl) {
    prevEl.innerHTML = prev
      ? `<a href="/topic/${prev.id}" aria-label="Previous topic: ${prev.title}">← ${prev.title}</a>`
      : '';
  }
  if (nextEl) {
    nextEl.innerHTML = next
      ? `<a href="/topic/${next.id}" aria-label="Next topic: ${next.title}">${next.title} →</a>`
      : '';
  }
}

// ─── Utility: HTML Escape ─────────────────────────────────────────────────────

function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function initAuth() {
  injectAuthModal();
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) currentUser = await res.json();
  } catch { /* stay logged out */ }
  updateAuthNav();
}

function isInstructor() {
  return currentUser?.role === 'instructor' || currentUser?.role === 'admin';
}

function isStudentPlus() {
  return ['student', 'instructor', 'admin'].includes(currentUser?.role);
}

function updateAuthNav() {
  const navItem = document.getElementById('authNavItem');
  if (!navItem) return;

  // Single ☰ menu, sectioned by content type and laid out as side-by-side
  // columns (one per section) so it grows wider rather than taller as more
  // links accumulate. Each column gets a small uppercase label; the
  // role-gated Staff column only renders when the viewer has at least one
  // staff link to show. Server routes still enforce roles; this gating only
  // controls visibility. Guest login lives in the Sign In modal instead.
  const showUnreadDot = currentUser?.hasUnreadAnnouncements;

  const col = (label, items) => {
    const rendered = items.filter(Boolean).join('');
    if (!rendered) return '';
    return `<div class="nav-dropdown-col"><div class="nav-dropdown-label">${label}</div>${rendered}</div>`;
  };

  const menuItems = [
    col('Learn', [
      `<a href="/start" class="nav-dropdown-item">Beginner Pathway</a>`,
      `<a href="/resources" class="nav-dropdown-item">Resources</a>`,
    ]),
    col('Challenges', [
      `<a href="/challenges" class="nav-dropdown-item">CTF Challenges</a>`,
    ]),
    col('Community', [
      `<a href="/announcements" class="nav-dropdown-item">Announcements${showUnreadDot ? ' <span class="nav-badge-dot" aria-label="Unread announcements"></span>' : ''}</a>`,
      `<a href="/events" class="nav-dropdown-item">Events</a>`,
      `<a href="/members" class="nav-dropdown-item">Member Directory</a>`,
    ]),
    col('Quizzes', [
      `<a href="/quiz" class="nav-dropdown-item">Join Room</a>`,
      `<a href="/leaderboard" class="nav-dropdown-item">Leaderboard</a>`,
    ]),
    col('Staff', [
      isStudentPlus() ? `<a href="/student-hub" class="nav-dropdown-item">Student Hub</a>` : '',
      isInstructor() ? `<a href="/instructor" class="nav-dropdown-item">Instructor Panel</a>` : '',
      currentUser?.role === 'admin' ? `<a href="/admin" class="nav-dropdown-item nav-dropdown-item--danger">Admin Panel</a>` : '',
    ]),
    col('More', [`<a href="/contact" class="nav-dropdown-item">Contact Us</a>`]),
  ].filter(Boolean).join('');

  const menuBtn = `<div class="nav-dropdown" id="navMenuDropdown">
      <button class="nav-dropdown-toggle" id="navMenuBtn" aria-label="Menu${showUnreadDot ? ' (unread announcements)' : ''}" aria-expanded="false">☰${showUnreadDot ? '<span class="nav-badge-dot" aria-hidden="true"></span>' : ''}</button>
      <div class="nav-dropdown-menu" id="navMenuList" hidden>${menuItems}</div>
    </div>`;

  if (currentUser) {
    const isGuest = currentUser.role === 'guest';
    const displayName = isGuest ? 'Guest' : currentUser.username;
    navItem.innerHTML = `
      ${menuBtn}
      <a href="/profile" class="navbar-username" aria-label="View your profile"><img src="${escHtml(currentUser.avatar || DEFAULT_AVATAR)}" alt="" class="navbar-avatar">${escHtml(displayName)}</a>
      ${isGuest ? `<button class="btn btn-sm" id="saveProgressBtn">Save Progress</button>` : ''}
      <button class="btn btn-sm" id="logoutBtn">Sign Out</button>`;
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('saveProgressBtn')?.addEventListener('click', openUpgradeModal);
  } else {
    navItem.innerHTML = `
      ${menuBtn}
      <button class="btn btn-sm" id="openAuthBtn">Sign In</button>`;
    document.getElementById('openAuthBtn').addEventListener('click', () => openAuthModal('login'));
  }

  wireNavDropdown('navMenuBtn', 'navMenuList');
}

function handleGuestLogin() {
  confirmDialog(
    'Guest sessions expire after 2 hours, and any progress you make will be lost when they do. Create an account to keep your progress.',
    startGuestSession,
    'Continue as Guest',
    { danger: false }
  );
}

async function startGuestSession() {
  try {
    const res = await fetch('/api/auth/guest', { method: 'POST' });
    if (!res.ok) throw new Error();
    currentUser = await res.json();
    closeAuthModal();
    updateAuthNav();
    window.location.reload();
  } catch {
    alert('Could not start a guest session. Please try again.');
  }
}

function wireNavDropdown(btnId, menuId) {
  const btn = document.getElementById(btnId);
  const menu = document.getElementById(menuId);
  if (!btn || !menu) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const nowOpen = menu.hidden;
    menu.hidden = !nowOpen;
    btn.setAttribute('aria-expanded', nowOpen);
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target)) {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

function handleLogout() {
  confirmDialog('Sign out of your account?', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    updateAuthNav();
    window.location.reload();
  }, 'Sign Out', { danger: false });
}

function confirmDialog(message, onConfirm, confirmLabel = 'Confirm', { danger = true } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="modal confirm-modal${danger ? '' : ' confirm-modal--neutral'}">
      <p class="confirm-message">${escHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn" id="confirmCancel">Cancel</button>
        <button class="btn${danger ? ' btn-danger' : ''}" id="confirmOk">${escHtml(confirmLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const btns = [overlay.querySelector('#confirmCancel'), overlay.querySelector('#confirmOk')];

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  btns[0].addEventListener('click', close);
  btns[1].addEventListener('click', () => { close(); onConfirm(); });

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = btns[btns.indexOf(document.activeElement) === 0 ? 1 : 0];
      next.focus();
    }
  }
  document.addEventListener('keydown', onKey);
  btns[1].focus();
}

function openAuthModal(tab) {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.hidden = false;
  setAuthTab(tab ?? 'login');
  setRegisterFormMode('register');
  const focusId = tab === 'register' ? 'regUsername' : 'loginUsername';
  document.getElementById(focusId)?.focus();
}

// Guests hit this from the "Save Progress" nav button: skip straight to the
// register form (their guest session already exists — signing in as someone
// else or "continuing as guest" again both make no sense here), and submit
// to /api/auth/upgrade instead of /api/auth/register so the account is
// converted in place rather than created fresh.
function openUpgradeModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.hidden = false;
  setAuthTab('register');
  setRegisterFormMode('upgrade');
  document.getElementById('regUsername')?.focus();
}

function setRegisterFormMode(mode) {
  const isUpgrade = mode === 'upgrade';
  document.getElementById('registerForm')?.setAttribute('data-mode', mode);
  document.getElementById('authModalTabs')?.toggleAttribute('hidden', isUpgrade);
  document.getElementById('upgradeIntro')?.toggleAttribute('hidden', !isUpgrade);
  document.getElementById('authModalGuestSection')?.toggleAttribute('hidden', isUpgrade);
  const submitBtn = document.getElementById('registerSubmitBtn');
  if (submitBtn) submitBtn.textContent = isUpgrade ? 'Save Progress' : 'Create Account';
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.hidden = true;
  ['loginError', 'registerError', 'forgotStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; el.textContent = ''; }
  });
  document.getElementById('loginForgotLinks')?.setAttribute('hidden', '');
}

// 'forgot' isn't a persistent .modal-tab (no tab button carries data-tab
//="forgot") — it's only reachable via the "Forgot ...?" links shown after a
// failed login, or the "Back to Sign In" link from within that view.
function setAuthTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const forgotForm   = document.getElementById('forgotForm');
  const guestSection = document.getElementById('authModalGuestSection');
  if (loginForm)    loginForm.hidden    = (tab !== 'login');
  if (registerForm) registerForm.hidden = (tab !== 'register');
  if (forgotForm)    forgotForm.hidden    = (tab !== 'forgot');
  if (guestSection)  guestSection.hidden  = (tab === 'forgot');
}

function injectAuthModal() {
  const modal = document.createElement('div');
  modal.id = 'authModal';
  modal.className = 'modal-overlay';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Sign in or create account');
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal">
      <button class="modal-close" id="modalClose" aria-label="Close">✕</button>
      <div class="modal-tabs" id="authModalTabs" role="tablist" aria-label="Authentication mode">
        <button class="modal-tab active" role="tab" aria-selected="true" data-tab="login">Sign In</button>
        <button class="modal-tab" role="tab" aria-selected="false" data-tab="register">Register</button>
      </div>
      <p class="form-hint" id="upgradeIntro" style="margin:-0.75rem 0 1rem" hidden>Create an account to save your guest progress — your quiz scores and streak carry over.</p>
      <form id="loginForm" class="modal-form" novalidate>
        <div class="form-group">
          <label for="loginUsername">Username</label>
          <input type="text" id="loginUsername" autocomplete="username" required>
        </div>
        <div class="form-group">
          <label for="loginPassword">Password</label>
          <input type="password" id="loginPassword" autocomplete="current-password" required>
        </div>
        <p class="form-error" id="loginError" aria-live="polite" hidden></p>
        <p class="modal-forgot-links" id="loginForgotLinks" hidden>
          <button type="button" class="link-btn" id="forgotPasswordLink">Forgot password?</button>
          &nbsp;·&nbsp;
          <button type="button" class="link-btn" id="forgotUsernameLink">Forgot username?</button>
        </p>
        <button type="submit" class="btn" style="width:100%;margin-top:0.25rem">Sign In</button>
      </form>
      <form id="registerForm" class="modal-form" novalidate hidden>
        <div class="form-group">
          <label for="regUsername">Username <span class="form-hint">3–20 chars, letters/numbers/_</span></label>
          <input type="text" id="regUsername" autocomplete="username" required minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]+">
        </div>
        <div class="form-group">
          <label for="regPassword">Password <span class="form-hint">min 8 characters</span></label>
          <input type="password" id="regPassword" autocomplete="new-password" required minlength="8">
        </div>
        <div class="form-group">
          <label for="regPasswordConfirm">Confirm Password</label>
          <input type="password" id="regPasswordConfirm" autocomplete="new-password" required minlength="8">
        </div>
        <p class="form-error" id="registerError" aria-live="polite" hidden></p>
        <button type="submit" class="btn" id="registerSubmitBtn" style="width:100%;margin-top:0.25rem">Create Account</button>
      </form>
      <div id="forgotForm" class="modal-form" hidden>
        <div class="form-group">
          <label for="forgotEmail">Your verified email</label>
          <input type="email" id="forgotEmail" autocomplete="email" required>
        </div>
        <p class="form-error" id="forgotStatus" aria-live="polite" hidden></p>
        <button type="button" class="btn" id="forgotUsernameSubmit" style="width:100%;margin-top:0.25rem">Email My Username</button>
        <button type="button" class="btn" id="forgotPasswordSubmit" style="width:100%;margin-top:0.5rem">Email a Reset Link</button>
        <button type="button" class="link-btn" id="forgotBackLink" style="margin-top:0.75rem">← Back to Sign In</button>
      </div>
      <div id="authModalGuestSection">
        <div class="modal-divider"><span>or</span></div>
        <button type="button" class="btn" id="guestLoginBtn" style="width:100%">Continue as Guest</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('modalClose').addEventListener('click', closeAuthModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeAuthModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAuthModal(); });
  document.querySelectorAll('.modal-tab').forEach(t => {
    t.addEventListener('click', () => setAuthTab(t.dataset.tab));
  });
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('registerForm').addEventListener('submit', handleRegister);
  document.getElementById('guestLoginBtn').addEventListener('click', handleGuestLogin);

  document.getElementById('forgotPasswordLink').addEventListener('click', () => openForgotView());
  document.getElementById('forgotUsernameLink').addEventListener('click', () => openForgotView());
  document.getElementById('forgotBackLink').addEventListener('click', () => setAuthTab('login'));
  document.getElementById('forgotUsernameSubmit').addEventListener('click', handleForgotUsername);
  document.getElementById('forgotPasswordSubmit').addEventListener('click', handleForgotPassword);
}

function openForgotView() {
  setAuthTab('forgot');
  const emailInput = document.getElementById('forgotEmail');
  const loginEmailish = document.getElementById('loginUsername')?.value.trim();
  if (emailInput && loginEmailish && loginEmailish.includes('@')) emailInput.value = loginEmailish;
  emailInput?.focus();
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const forgotLinks = document.getElementById('loginForgotLinks');
  errEl.hidden   = true;
  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Login failed.';
      errEl.hidden = false;
      if (forgotLinks) forgotLinks.hidden = false;
      return;
    }
    currentUser = data;
    closeAuthModal();
    updateAuthNav();
    window.location.reload();
  } catch {
    errEl.textContent = 'Network error. Please try again.';
    errEl.hidden = false;
  }
}

// Server always responds { ok: true } for a validly-shaped email regardless
// of whether it matched an account (anti-enumeration — same principle as
// login's generic "Invalid username or password"), so both handlers show one
// generic message on success rather than anything account-specific.
async function submitForgotAction(endpoint, successMessage) {
  const email  = document.getElementById('forgotEmail').value.trim();
  const status = document.getElementById('forgotStatus');
  status.style.color = '';
  status.hidden = true;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || 'Something went wrong. Please try again.';
      status.hidden = false;
      return;
    }
    status.style.color = 'var(--accent)';
    status.textContent = successMessage;
    status.hidden = false;
  } catch {
    status.textContent = 'Network error. Please try again.';
    status.hidden = false;
  }
}

function handleForgotUsername() {
  submitForgotAction('/api/auth/forgot-username', 'If that email is on file, we’ve sent a reminder — check your inbox.');
}

function handleForgotPassword() {
  submitForgotAction('/api/auth/forgot-password', 'If that email is on file, we’ve sent a reset link — check your inbox.');
}

async function handleRegister(e) {
  e.preventDefault();
  const isUpgrade = document.getElementById('registerForm')?.dataset.mode === 'upgrade';
  const endpoint  = isUpgrade ? '/api/auth/upgrade' : '/api/auth/register';
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regPasswordConfirm').value;
  const errEl    = document.getElementById('registerError');
  errEl.hidden   = true;
  if (password !== confirm) {
    errEl.textContent = 'Passwords do not match.';
    errEl.hidden = false;
    return;
  }
  try {
    const res  = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || (isUpgrade ? 'Could not save your progress.' : 'Registration failed.'); errEl.hidden = false; return; }
    currentUser = data;
    closeAuthModal();
    updateAuthNav();
    window.location.reload();
  } catch {
    errEl.textContent = 'Network error. Please try again.';
    errEl.hidden = false;
  }
}

// ─── Progress ─────────────────────────────────────────────────────────────────

async function saveProgress(topicId, answers) {
  if (!currentUser) return;
  try {
    await fetch(`/api/progress/${topicId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
  } catch { /* don't disrupt the user experience */ }
}

async function resetProgress(topicId, onReset) {
  if (!currentUser) return;
  try {
    await fetch(`/api/progress/${topicId}`, { method: 'DELETE' });
    const banner = document.getElementById('progressBanner');
    if (banner) banner.remove();
    if (onReset) onReset();
  } catch { /* don't disrupt the user experience */ }
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────

async function initAdminPanel() {
  if (currentUser?.role !== 'admin') {
    window.location.replace('/');
    return;
  }

  let allUsers = [];
  let sortCol = null;
  let sortDir = 0; // 0=none, 1=asc, 2=desc

  function getSorted(users) {
    if (sortDir === 0 || !sortCol) return users;
    return [...users].sort((a, b) => {
      let av, bv;
      if (sortCol === 'username') { av = a.username.toLowerCase(); bv = b.username.toLowerCase(); }
      else if (sortCol === 'role')    { av = a.role; bv = b.role; }
      else if (sortCol === 'joined')  { av = new Date(a.created_at); bv = new Date(b.created_at); }
      if (av < bv) return sortDir === 1 ? -1 : 1;
      if (av > bv) return sortDir === 1 ? 1 : -1;
      return 0;
    });
  }

  async function loadUsers() {
    const wrap = document.getElementById('adminTableWrap');
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error();
      const { results } = await res.json();
      allUsers = results;
      renderTable(allUsers);
    } catch {
      wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load users.</p>`;
    }
  }

  function renderTable(users) {
    const wrap = document.getElementById('adminTableWrap');
    const sorted = getSorted(users);
    if (!users.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No users found.</p>`;
      return;
    }
    const thClass = (col) => {
      const base = 'sortable';
      if (sortCol === col) return base + (sortDir === 1 ? ' sort-asc' : ' sort-desc');
      return base;
    };
    wrap.innerHTML = `
      <table class="admin-table" role="table" aria-label="User list">
        <thead>
          <tr>
            <th class="${thClass('username')}" data-sort="username">Username</th>
            <th class="${thClass('role')}" data-sort="role">Role</th>
            <th class="${thClass('joined')}" data-sort="joined">Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(u => {
            const isSelf = u.id === currentUser?.id;
            const joined = new Date(u.created_at).toLocaleDateString();
            return `
              <tr data-uid="${u.id}">
                <td style="font-family:'Share Tech Mono',monospace;"><a href="/u/${encodeURIComponent(u.username)}" class="admin-user-link">${escHtml(u.username)}</a></td>
                <td>
                  <select class="role-select" data-uid="${u.id}" ${isSelf ? 'disabled' : ''} aria-label="Role for ${escHtml(u.username)}">
                    <option value="member"     ${u.role === 'member'     ? 'selected' : ''}>member</option>
                    <option value="student"    ${u.role === 'student'    ? 'selected' : ''}>student</option>
                    <option value="instructor" ${u.role === 'instructor' ? 'selected' : ''}>instructor</option>
                    <option value="admin"      ${u.role === 'admin'      ? 'selected' : ''}>admin</option>
                  </select>
                </td>
                <td style="color:var(--text-muted);font-size:0.85rem;">${joined}</td>
                <td>
                  <button class="btn btn-danger btn-sm delete-user-btn" data-uid="${u.id}" data-username="${escHtml(u.username)}" ${isSelf ? 'disabled title="Cannot delete your own account"' : ''}>
                    Delete
                  </button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (sortCol === col) {
          sortDir = sortDir === 1 ? 2 : sortDir === 2 ? 0 : 1;
          if (sortDir === 0) sortCol = null;
        } else {
          sortCol = col;
          sortDir = 1;
        }
        renderTable(filterUsers(document.getElementById('userSearch')?.value ?? ''));
      });
    });

    wrap.querySelectorAll('.role-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const uid = parseInt(sel.dataset.uid, 10);
        const newRole = sel.value;
        const user = allUsers.find(u => u.id === uid);
        const prevRole = user?.role;

        const doChange = async () => {
          const res = await fetch(`/api/admin/users/${uid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole }),
          });
          if (res.ok) {
            if (user) user.role = newRole;
          } else {
            sel.value = prevRole;
            alert('Failed to update role.');
          }
        };

        if (prevRole === 'admin') {
          confirmDialog(`Remove admin from ${user?.username ?? 'this user'}? This cannot be undone.`, doChange, 'Demote');
          sel.value = prevRole;
        } else {
          await doChange();
        }
      });
    });

    wrap.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = parseInt(btn.dataset.uid, 10);
        const username = btn.dataset.username;
        confirmDialog(`Permanently delete account "${username}"? This will erase all their quiz data.`, async () => {
          const res = await fetch(`/api/admin/users/${uid}`, { method: 'DELETE' });
          if (res.ok) {
            allUsers = allUsers.filter(u => u.id !== uid);
            renderTable(filterUsers(document.getElementById('userSearch')?.value ?? ''));
          } else {
            alert('Failed to delete user.');
          }
        }, 'Delete');
      });
    });
  }

  function filterUsers(query) {
    const q = query.trim().toLowerCase();
    return q ? allUsers.filter(u => u.username.toLowerCase().includes(q)) : allUsers;
  }

  document.getElementById('userSearch')?.addEventListener('input', e => {
    renderTable(filterUsers(e.target.value));
  });

  await loadUsers();
  await loadFeedback();
  await loadAuditLog();
}

// Append-only audit trail — read-only UI, cursor-paginated ("Load more").
// No edit/delete affordance here, ever: the log has no PATCH/DELETE route
// server-side (see logAudit() in worker.js), and this UI must not imply one.
async function loadAuditLog() {
  const wrap = document.getElementById('auditLogTableWrap');
  const moreBtn = document.getElementById('auditLogLoadMoreBtn');
  if (!wrap) return;

  let rows = [];
  const ACTION_LABELS = {
    'user.role_change': 'Role change',
    'user.delete': 'User deleted',
    'announcement.create': 'Announcement created',
    'announcement.edit': 'Announcement edited',
    'announcement.delete': 'Announcement deleted',
    'room.delete': 'Room deleted',
  };

  function render() {
    if (!rows.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No audit entries yet.</p>`;
      return;
    }
    wrap.innerHTML = `
      <table class="admin-table" aria-label="Audit log">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td style="color:var(--text-muted);font-size:0.85rem;white-space:nowrap;">${new Date(r.created_at).toLocaleString()}</td>
            <td>${escHtml(r.actor_name)}</td>
            <td>${escHtml(ACTION_LABELS[r.action] ?? r.action)}</td>
            <td>${escHtml(r.target)}</td>
            <td style="font-size:0.85rem;color:var(--text-muted);">${(r.detail ?? []).map(d =>
              `${escHtml(d.field)}: ${escHtml(String(d.before ?? '—'))} → ${escHtml(String(d.after ?? '—'))}`
            ).join('; ')}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function loadPage(before) {
    const params = new URLSearchParams({ limit: '50' });
    if (before) params.set('before', String(before));
    const res = await fetch(`/api/admin/audit-log?${params}`);
    if (!res.ok) throw new Error();
    const { results } = await res.json();
    rows = rows.concat(results ?? []);
    render();
    if (moreBtn) moreBtn.hidden = (results ?? []).length < 50;
  }

  try {
    await loadPage();
  } catch {
    wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load audit log.</p>`;
    return;
  }

  moreBtn?.addEventListener('click', () => {
    const lastId = rows[rows.length - 1]?.id;
    if (lastId) loadPage(lastId);
  });
}

async function loadFeedback() {
  const wrap = document.getElementById('feedbackTableWrap');
  if (!wrap) return;
  let items = [];
  try {
    const res = await fetch('/api/feedback');
    if (!res.ok) throw new Error();
    const data = await res.json();
    items = data.results ?? [];
  } catch {
    wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load messages.</p>`;
    return;
  }

  function render() {
    if (!items.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No messages yet.</p>`;
      return;
    }
    wrap.innerHTML = items.map(f => `
      <div class="card announcement-card">
        <p class="card-desc">${escHtml(f.message)}</p>
        <div class="card-footer announcement-footer">
          <span class="announcement-meta">${escHtml(f.username || 'Anonymous')} — ${new Date(f.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          <div class="announcement-actions">
            <button type="button" class="btn btn-sm btn-danger delete-feedback-btn" data-id="${f.id}">Delete</button>
          </div>
        </div>
      </div>`).join('');

    wrap.querySelectorAll('.delete-feedback-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        confirmDialog('Delete this message? This cannot be undone.', async () => {
          const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE' });
          if (res.ok) {
            items = items.filter(x => x.id !== id);
            render();
          } else {
            alert('Failed to delete message.');
          }
        }, 'Delete');
      });
    });
  }

  render();
}

// ─── Instructor Panel ─────────────────────────────────────────────────────────

async function initInstructorPanel() {
  if (!isInstructor()) {
    window.location.replace('/');
    return;
  }

  let allRooms = [];
  let currentResultsData = null;

  // File input label update
  document.getElementById('roomFile')?.addEventListener('change', e => {
    const file = e.target.files[0];
    document.getElementById('fileInputText').textContent = file ? file.name : 'Choose .csv or .json file...';
  });

  // Copy new room code link
  document.getElementById('copyCodeBtn')?.addEventListener('click', () => {
    const code = document.getElementById('newRoomCode')?.textContent;
    if (code) {
      navigator.clipboard.writeText(`${window.location.origin}/quiz/${code}`).then(() => {
        const btn = document.getElementById('copyCodeBtn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy Link'; }, 2000);
      });
    }
  });

  document.getElementById('backToRoomsBtn')?.addEventListener('click', () => showSection('rooms'));
  document.getElementById('exportCsvBtn')?.addEventListener('click', exportResultsCSV);
  document.getElementById('createRoomForm')?.addEventListener('submit', handleCreateRoom);

  // ── Question source mode toggle ──
  const manualBuilderWrap = document.getElementById('manualBuilderWrap');
  const fileImportWrap = document.getElementById('fileImportWrap');
  const templateWrap = document.getElementById('templateWrap');
  let templatesLoaded = false;

  document.getElementById('questionSourceMode')?.addEventListener('change', async e => {
    const mode = e.target.value;
    manualBuilderWrap.hidden = mode !== 'manual';
    fileImportWrap.hidden = mode !== 'file';
    templateWrap.hidden = mode !== 'template';
    if (mode === 'template' && !templatesLoaded) {
      templatesLoaded = true;
      await loadTemplateOptions();
    }
  });

  async function loadTemplateOptions() {
    const select = document.getElementById('templateSelect');
    try {
      const res = await fetch('/api/question-bank');
      if (!res.ok) throw new Error();
      const { results } = await res.json();
      select.innerHTML = results.length
        ? results.map(b => `<option value="${b.id}">${escHtml(b.title)} (${b.question_count} questions)</option>`).join('')
        : '<option value="">No saved banks yet — save a room as a template first</option>';
    } catch {
      select.innerHTML = '<option value="">Failed to load saved banks</option>';
    }
  }

  // ── Manual quiz builder ──
  const ANSWER_LETTERS = ['A', 'B', 'C', 'D'];
  const manualList = document.getElementById('manualQuestionsList');
  let qCounter = 0;

  function createAnswerRow() {
    const row = document.createElement('div');
    row.className = 'quiz-answer-row';
    row.innerHTML = `
      <input type="radio" class="quiz-answer-correct" aria-label="Mark as correct answer">
      <input type="text" class="quiz-answer-text" maxlength="300">
      <button type="button" class="quiz-answer-remove" aria-label="Remove answer">✕</button>`;
    return row;
  }

  function relabelCard(card) {
    const qid = card.dataset.qid;
    const rows = [...card.querySelectorAll('.quiz-answer-row')];
    rows.forEach((row, i) => {
      row.querySelector('.quiz-answer-correct').name = `correct-${qid}`;
      row.querySelector('.quiz-answer-text').placeholder = `Answer ${ANSWER_LETTERS[i] ?? i + 1}`;
    });
    const addBtn = card.querySelector('.quiz-add-answer');
    if (addBtn) addBtn.disabled = rows.length >= 4;
    card.querySelectorAll('.quiz-answer-remove').forEach(btn => { btn.disabled = rows.length <= 2; });
  }

  function renumberQuestions() {
    manualList.querySelectorAll('.quiz-card').forEach((card, i) => {
      card.querySelector('.quiz-card-index').textContent = `Question ${i + 1}`;
    });
    manualList.querySelectorAll('.quiz-card-remove').forEach(btn => {
      btn.disabled = manualList.children.length <= 1;
    });
  }

  function setCardType(card, type) {
    const mcFields = card.querySelector('.quiz-mc-fields');
    const frNote   = card.querySelector('.quiz-fr-note');
    const isFR = type === 'free_response';
    if (mcFields) mcFields.hidden = isFR;
    if (frNote) frNote.hidden = !isFR;
    const explanationLabel = card.querySelector('.quiz-explanation-label');
    if (explanationLabel) {
      explanationLabel.firstChild.textContent = isFR ? 'Model Answer / Grading Notes ' : 'Explanation ';
    }
  }

  function addQuestionCard() {
    const qid = ++qCounter;
    const card = document.createElement('div');
    card.className = 'quiz-card';
    card.dataset.qid = qid;
    card.innerHTML = `
      <div class="quiz-card-header">
        <span class="quiz-card-index">Question</span>
        <button type="button" class="quiz-card-remove" aria-label="Remove question">✕</button>
      </div>
      <div class="form-group">
        <label>Type</label>
        <select class="quiz-q-type">
          <option value="multiple_choice" selected>Multiple Choice</option>
          <option value="free_response">Free Response</option>
        </select>
      </div>
      <div class="form-group">
        <label>Question Text</label>
        <textarea class="quiz-q-text" rows="2" maxlength="1000" placeholder="e.g. What does CIA stand for?"></textarea>
      </div>
      <div class="quiz-mc-fields">
        <div class="quiz-answers"></div>
        <button type="button" class="btn btn-sm quiz-add-answer">+ Add Answer</button>
      </div>
      <p class="quiz-fr-note" hidden>Students will type a free-text response. You'll grade each submission as correct/incorrect afterward.</p>
      <div class="form-group" style="margin-top:0.75rem;">
        <label class="quiz-explanation-label">Explanation <span class="form-hint">optional</span></label>
        <textarea class="quiz-q-explanation" rows="2" maxlength="2000" placeholder="Shown to student after they answer"></textarea>
      </div>`;
    const answersWrap = card.querySelector('.quiz-answers');
    answersWrap.appendChild(createAnswerRow());
    answersWrap.appendChild(createAnswerRow());
    manualList.appendChild(card);
    relabelCard(card);
    renumberQuestions();
    card.querySelector('.quiz-q-text').focus();
  }

  document.getElementById('addQuestionBtn')?.addEventListener('click', addQuestionCard);

  manualList?.addEventListener('click', e => {
    const card = e.target.closest('.quiz-card');
    if (!card) return;
    if (e.target.closest('.quiz-card-remove')) {
      if (manualList.children.length <= 1) return;
      card.remove();
      renumberQuestions();
    } else if (e.target.closest('.quiz-add-answer')) {
      const answersWrap = card.querySelector('.quiz-answers');
      if (answersWrap.children.length >= 4) return;
      answersWrap.appendChild(createAnswerRow());
      relabelCard(card);
    } else if (e.target.closest('.quiz-answer-remove')) {
      const answersWrap = card.querySelector('.quiz-answers');
      if (answersWrap.children.length <= 2) return;
      e.target.closest('.quiz-answer-row').remove();
      relabelCard(card);
    }
  });

  manualList?.addEventListener('change', e => {
    if (!e.target.classList.contains('quiz-q-type')) return;
    const card = e.target.closest('.quiz-card');
    if (card) setCardType(card, e.target.value);
  });

  // Seed with one empty question to start
  if (manualList && !manualList.children.length) addQuestionCard();

  function gatherManualQuestions() {
    const cards = [...manualList.querySelectorAll('.quiz-card')];
    const questions = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const type = card.querySelector('.quiz-q-type').value === 'free_response' ? 'free_response' : 'multiple_choice';
      const question = card.querySelector('.quiz-q-text').value.trim();
      if (!question) return { error: `Question ${i + 1}: question text is required` };
      const explanation = card.querySelector('.quiz-q-explanation').value.trim();

      if (type === 'free_response') {
        questions.push({ question, type, answers: [], correct: null, explanation });
        continue;
      }

      const rows = [...card.querySelectorAll('.quiz-answer-row')];
      const answers = rows.map(r => r.querySelector('.quiz-answer-text').value.trim());
      if (answers.some(a => !a)) return { error: `Question ${i + 1}: answer text cannot be empty` };

      const correct = rows.findIndex(r => r.querySelector('.quiz-answer-correct').checked);
      if (correct === -1) return { error: `Question ${i + 1}: select which answer is correct` };

      questions.push({ question, type, answers, correct, explanation });
    }
    if (!questions.length) return { error: 'Add at least one question' };
    return { questions };
  }

  await loadRooms();
  await loadTopicCompletion();
  await loadQuestionBank();

  // Private per-instructor reusable question templates. No delete-then-
  // recreate ownership loophole here — DELETE /api/question-bank/:id already
  // enforces created_by === session.sub (or admin) server-side.
  async function loadQuestionBank() {
    const wrap = document.getElementById('questionBankWrap');
    if (!wrap) return;
    try {
      const res = await fetch('/api/question-bank');
      if (!res.ok) throw new Error();
      const { results } = await res.json();
      wrap.innerHTML = results.length
        ? results.map(b => `
          <div class="card announcement-card">
            <h3 class="card-title">${escHtml(b.title)}</h3>
            <div class="card-footer announcement-footer">
              <span class="announcement-meta">${b.question_count} question${b.question_count === 1 ? '' : 's'} · saved ${new Date(b.created_at).toLocaleDateString()}</span>
              <div class="announcement-actions">
                <button type="button" class="btn btn-sm btn-danger delete-bank-btn" data-id="${b.id}" data-title="${escHtml(b.title)}">Delete</button>
              </div>
            </div>
          </div>`).join('')
        : `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No saved question banks yet — use "Save as Template" from a room's results view.</p>`;

      wrap.querySelectorAll('.delete-bank-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          confirmDialog(`Delete question bank "${btn.dataset.title}"? This cannot be undone.`, async () => {
            const res = await fetch(`/api/question-bank/${btn.dataset.id}`, { method: 'DELETE' });
            if (res.ok) {
              await loadQuestionBank();
              templatesLoaded = false; // force a refetch next time the "Use a Saved Template" mode is opened
            } else {
              alert('Failed to delete question bank.');
            }
          }, 'Delete');
        });
      });
    } catch {
      wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load question bank.</p>`;
    }
  }

  document.getElementById('saveAsTemplateBtn')?.addEventListener('click', () => {
    if (!currentResultsData) return;
    const defaultTitle = currentResultsData.room?.title ?? '';
    const title = prompt('Save as a question bank template. Title:', defaultTitle);
    if (title === null) return; // cancelled
    (async () => {
      const res = await fetch(`/api/rooms/${currentResultsData.code}/save-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Failed to save template.'); return; }
      await loadQuestionBank();
      templatesLoaded = false;
      alert(`Saved "${data.title}" (${data.questionCount} questions) to your Question Bank.`);
    })();
  });

  // Site-wide (not per-class — quiz_results has no roster/class concept, see
  // /api/instructor/topic-completion) topic-quiz completion, read-only.
  async function loadTopicCompletion() {
    const wrap = document.getElementById('topicCompletionWrap');
    if (!wrap) return;
    try {
      const [completionRes, topicsRes] = await Promise.all([
        fetch('/api/instructor/topic-completion'),
        fetch('/api/topics'),
      ]);
      if (!completionRes.ok || !topicsRes.ok) throw new Error();
      const { results } = await completionRes.json();
      const topics = await topicsRes.json();
      const byTopic = {};
      for (const r of (results ?? [])) byTopic[r.topic_id] = r;

      wrap.innerHTML = `
        <table class="admin-table">
          <thead><tr><th>Topic</th><th>Completions</th><th>Avg. Score</th></tr></thead>
          <tbody>
            ${topics.map(t => {
              const r = byTopic[t.id];
              return `<tr>
                <td>${escHtml(t.title)}</td>
                <td>${r ? r.completions : 0}</td>
                <td>${r && r.avg_pct != null ? `${Math.round(r.avg_pct * 100)}%` : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    } catch {
      wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load topic completion.</p>`;
    }
  }

  async function handleCreateRoom(e) {
    e.preventDefault();
    const errEl = document.getElementById('createRoomError');
    const successEl = document.getElementById('createRoomSuccess');
    errEl.hidden = true;
    successEl.hidden = true;

    const title = document.getElementById('roomTitle').value.trim();
    const mode = document.getElementById('questionSourceMode').value;
    const fileInput = document.getElementById('roomFile');
    const expiry = document.getElementById('roomExpiry').value;
    const visibility = document.getElementById('roomVisibility').value;

    if (!title) { errEl.textContent = 'Room title is required.'; errEl.hidden = false; return; }

    const fd = new FormData();
    fd.append('title', title);
    fd.append('visibility', visibility);
    if (expiry) fd.append('expires_at', new Date(expiry).toISOString());

    if (mode === 'manual') {
      const result = gatherManualQuestions();
      if (result.error) { errEl.textContent = result.error; errEl.hidden = false; return; }
      const blob = new Blob([JSON.stringify(result.questions)], { type: 'application/json' });
      fd.append('file', blob, 'manual-questions.json');
    } else if (mode === 'template') {
      const templateId = document.getElementById('templateSelect').value;
      if (!templateId) { errEl.textContent = 'Please select a saved question bank.'; errEl.hidden = false; return; }
      fd.append('template_id', templateId);
    } else {
      if (!fileInput.files.length) { errEl.textContent = 'Please select a .csv or .json question file.'; errEl.hidden = false; return; }
      fd.append('file', fileInput.files[0]);
    }

    const submitBtn = e.target.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      const res = await fetch('/api/rooms', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Failed to create room.'; errEl.hidden = false; return; }
      document.getElementById('newRoomCode').textContent = data.code;
      document.getElementById('newRoomQuestionCount').textContent = data.questionCount;
      successEl.hidden = false;
      e.target.reset();
      document.getElementById('fileInputText').textContent = 'Choose .csv or .json file...';
      manualBuilderWrap.hidden = false;
      fileImportWrap.hidden = true;
      templateWrap.hidden = true;
      manualList.innerHTML = '';
      addQuestionCard();
      await loadRooms();
    } catch {
      errEl.textContent = 'Network error. Please try again.';
      errEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Room';
    }
  }

  async function loadRooms() {
    const wrap = document.getElementById('roomsTableWrap');
    wrap.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">Loading rooms...</p>`;
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) throw new Error();
      const { results } = await res.json();
      allRooms = results;
      renderRoomsTable(allRooms);
    } catch {
      wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load rooms.</p>`;
    }
  }

  function renderRoomsTable(rooms) {
    const wrap = document.getElementById('roomsTableWrap');
    if (!rooms.length) {
      wrap.innerHTML = `
        <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);font-family:'Share Tech Mono',monospace;background:var(--surface);border:1px solid var(--border);border-radius:6px;">
          <p style="font-size:2rem;margin-bottom:0.75rem;">📋</p>
          <p>No rooms yet. Create your first quiz room above.</p>
        </div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="admin-table" role="table" aria-label="Quiz rooms">
        <thead>
          <tr>
            <th>Title</th>
            <th>Code</th>
            <th>Status</th>
            <th>Visibility</th>
            <th style="text-align:center;">Qs</th>
            <th style="text-align:center;">Attempts</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rooms.map(r => {
            const isOpen = r.status === 'open';
            const visClass = r.visibility === 'public' ? 'open' : r.visibility === 'student' ? 'student' : 'closed';
            const visLabel = r.visibility === 'public' ? 'Public' : r.visibility === 'student' ? 'Student Only' : 'Private';
            return `
              <tr>
                <td style="font-family:'Share Tech Mono',monospace;">${escHtml(r.title)}</td>
                <td><code class="room-code-copy" data-code="${escHtml(r.code)}" title="Click to copy code" tabindex="0" role="button">${escHtml(r.code)}</code></td>
                <td><span class="status-badge status-${isOpen ? 'open' : 'closed'}">${isOpen ? 'Open' : 'Closed'}</span></td>
                <td><span class="status-badge status-${visClass}">${visLabel}</span></td>
                <td style="text-align:center;color:var(--text-muted);">${r.question_count}</td>
                <td style="text-align:center;color:var(--text-muted);">${r.attempt_count}</td>
                <td style="color:var(--text-muted);font-size:0.85rem;">${new Date(r.created_at).toLocaleDateString()}</td>
                <td class="room-actions">
                  <button class="btn btn-sm copy-link-btn" data-code="${escHtml(r.code)}">Copy Link</button>
                  <button class="btn btn-sm toggle-status-btn" data-code="${escHtml(r.code)}" data-status="${escHtml(r.status)}">${isOpen ? 'Close' : 'Reopen'}</button>
                  <button class="btn btn-sm view-results-btn" data-code="${escHtml(r.code)}" data-title="${escHtml(r.title)}">Results</button>
                  <button class="btn btn-sm btn-danger delete-room-btn" data-code="${escHtml(r.code)}" data-title="${escHtml(r.title)}">Delete</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('.copy-link-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(`${window.location.origin}/quiz/${btn.dataset.code}`).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy Link'; }, 2000);
        });
      });
    });

    wrap.querySelectorAll('.room-code-copy').forEach(el => {
      const copy = () => {
        navigator.clipboard.writeText(el.dataset.code).then(() => {
          const original = el.textContent;
          el.textContent = 'Copied!';
          setTimeout(() => { el.textContent = original; }, 1500);
        });
      };
      el.addEventListener('click', copy);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(); }
      });
    });

    wrap.querySelectorAll('.toggle-status-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newStatus = btn.dataset.status === 'open' ? 'closed' : 'open';
        const res = await fetch(`/api/rooms/${btn.dataset.code}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (res.ok) {
          const room = allRooms.find(r => r.code === btn.dataset.code);
          if (room) room.status = newStatus;
          renderRoomsTable(allRooms);
        } else {
          alert('Failed to update room status.');
        }
      });
    });

    wrap.querySelectorAll('.view-results-btn').forEach(btn => {
      btn.addEventListener('click', () => loadResults(btn.dataset.code, btn.dataset.title));
    });

    wrap.querySelectorAll('.delete-room-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        confirmDialog(`Delete room "${btn.dataset.title}" and all attempt data? This cannot be undone.`, async () => {
          const res = await fetch(`/api/rooms/${btn.dataset.code}`, { method: 'DELETE' });
          if (res.ok) {
            allRooms = allRooms.filter(r => r.code !== btn.dataset.code);
            renderRoomsTable(allRooms);
          } else {
            alert('Failed to delete room.');
          }
        }, 'Delete');
      });
    });
  }

  async function loadResults(code, title) {
    showSection('results');
    document.getElementById('resultsRoomTitle').textContent = `// ${title}`;
    document.getElementById('resultsRoomCode').textContent = code;
    document.getElementById('resultsSummary').innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">Loading results...</p>`;
    document.getElementById('resultsAnalytics').innerHTML = '';
    document.getElementById('resultsRoster').innerHTML = '';

    try {
      const res = await fetch(`/api/rooms/${code}/results`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      currentResultsData = { ...data, code };
      renderResults(data);
    } catch {
      document.getElementById('resultsSummary').innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load results.</p>`;
    }

    loadAnalytics(code);
  }

  // Per-question miss-rate — fetched separately from /results so a failure
  // here never blocks the roster from rendering.
  async function loadAnalytics(code) {
    const wrap = document.getElementById('resultsAnalytics');
    if (!wrap) return;
    try {
      const res = await fetch(`/api/rooms/${code}/analytics`);
      if (!res.ok) throw new Error();
      const { questions } = await res.json();
      if (!questions.length) { wrap.innerHTML = ''; return; }
      wrap.innerHTML = `
        <h3 class="instructor-section-heading" style="font-size:1rem;">// Question Miss-Rates</h3>
        <table class="admin-table">
          <thead><tr><th>Question</th><th>Miss Rate</th><th>Answered</th><th>Pending</th></tr></thead>
          <tbody>
            ${questions.map(q => `<tr>
              <td>${escHtml(q.question)}</td>
              <td>${Math.round(q.missRate * 100)}%</td>
              <td>${q.answeredCount - q.pendingCount}</td>
              <td>${q.pendingCount}</td>
            </tr>`).join('')}
          </tbody>
        </table>`;
    } catch {
      wrap.innerHTML = '';
    }
  }

  function renderResults({ questions, attempts }) {
    const summaryEl = document.getElementById('resultsSummary');
    const rosterEl  = document.getElementById('resultsRoster');

    const avgScore = attempts.length
      ? (attempts.reduce((s, a) => s + a.score, 0) / attempts.length).toFixed(1)
      : null;
    const total = attempts.length ? attempts[0].total : questions.length;
    const totalPending = attempts.reduce((s, a) => s + (a.pendingCount ?? 0), 0);
    const hasFreeResponse = questions.some(q => q.type === 'free_response');

    summaryEl.innerHTML = `
      <div class="results-summary-grid">
        <div class="results-stat">
          <span class="results-stat-val">${attempts.length}</span>
          <span class="results-stat-label">Students Attempted</span>
        </div>
        <div class="results-stat">
          <span class="results-stat-val">${avgScore !== null ? `${avgScore}/${total}` : '—'}</span>
          <span class="results-stat-label">Average Score</span>
        </div>
        <div class="results-stat">
          <span class="results-stat-val">${questions.length}</span>
          <span class="results-stat-label">Questions</span>
        </div>
        ${hasFreeResponse ? `
        <div class="results-stat">
          <span class="results-stat-val" style="color:${totalPending > 0 ? '#4488ff' : 'var(--accent)'};">${totalPending}</span>
          <span class="results-stat-label">Pending Review</span>
        </div>` : ''}
      </div>`;

    if (!attempts.length) {
      rosterEl.innerHTML = `
        <div style="text-align:center;padding:2rem;color:var(--text-muted);font-family:'Share Tech Mono',monospace;background:var(--surface);border:1px solid var(--border);border-radius:6px;">
          No attempts yet — share the room code with students to get started.
        </div>`;
      return;
    }

    rosterEl.innerHTML = `
      <table class="admin-table" role="table" aria-label="Attempt roster">
        <thead>
          <tr>
            <th style="width:28px;"></th>
            <th>Student</th>
            <th>Score</th>
            <th>Completed</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="rosterBody"></tbody>
      </table>`;

    const tbody = document.getElementById('rosterBody');
    attempts.forEach(att => {
      const pct = Math.round((att.score / att.total) * 100);
      const scoreColor = att.score === att.total ? 'var(--accent)' : att.score / att.total >= 0.7 ? 'var(--warn)' : 'var(--danger)';

      const pendingBadge = att.pendingCount
        ? ` <span class="quiz-pending-badge" style="margin-top:0;">${att.pendingCount} pending</span>`
        : '';

      const row = document.createElement('tr');
      row.innerHTML = `
        <td><button class="expand-btn" aria-expanded="false" aria-label="Expand answers for ${escHtml(att.username)}">▶</button></td>
        <td style="font-family:'Share Tech Mono',monospace;">${escHtml(att.username)}</td>
        <td><span style="font-family:'Share Tech Mono',monospace;color:${scoreColor};">${att.score}/${att.total} (${pct}%)</span>${pendingBadge}</td>
        <td style="color:var(--text-muted);font-size:0.85rem;">${new Date(att.completed_at).toLocaleString()}</td>
        <td class="room-actions">
          <button class="btn btn-sm review-answers-btn" data-attempt-id="${att.id}">Review Answers</button>
          <button class="btn btn-sm btn-danger reset-attempt-btn" data-attempt-id="${att.id}" data-username="${escHtml(att.username)}">Reset Attempt</button>
        </td>`;

      const detailRow = document.createElement('tr');
      detailRow.className = 'answer-detail-row';
      detailRow.hidden = true;
      detailRow.innerHTML = `
        <td colspan="5" style="padding:0;">
          <div class="answer-detail-wrap">
            ${questions.map((q, qi) => {
              const ans = (att.answers ?? []).find(a => a.question_id === q.id);

              if (q.type === 'free_response') {
                const pending = !ans || ans.is_correct === null;
                const isCorrect = !!ans?.is_correct;
                const rowClass = pending ? 'answer-pending' : (isCorrect ? 'answer-correct' : 'answer-wrong');
                const icon = pending ? '⋯' : (isCorrect ? '✓' : '✗');
                return `
                  <div class="answer-row-fr ${rowClass}">
                    <div class="answer-question"><span class="answer-icon">${icon}</span>Q${qi + 1}: ${escHtml(q.question)}</div>
                    <div class="quiz-free-response-display">${escHtml(ans?.response_text || '(no answer submitted)')}</div>
                    ${q.explanation ? `<div class="quiz-grading-notes"><strong>Grading notes:</strong> ${escHtml(q.explanation)}</div>` : ''}
                    ${pending
                      ? `<div class="grade-actions">
                           <button type="button" class="btn btn-sm grade-btn" data-answer-id="${ans?.id}" data-verdict="1">Mark Correct</button>
                           <button type="button" class="btn btn-sm btn-danger grade-btn" data-answer-id="${ans?.id}" data-verdict="0">Mark Incorrect</button>
                         </div>`
                      : `<div class="answer-choice">Graded: ${isCorrect ? 'Correct' : 'Incorrect'}</div>`}
                  </div>`;
              }

              const correct = ans?.is_correct;
              const selectedLabel = ans !== undefined ? String.fromCharCode(65 + ans.selected) : '—';
              const correctLabel = String.fromCharCode(65 + q.correct);
              return `
                <div class="answer-row ${correct ? 'answer-correct' : 'answer-wrong'}">
                  <span class="answer-icon">${correct ? '✓' : '✗'}</span>
                  <span class="answer-question">Q${qi + 1}: ${escHtml(q.question)}</span>
                  <span class="answer-choice">Chose: ${selectedLabel}${!correct ? ` · Correct: ${correctLabel}` : ''}</span>
                </div>`;
            }).join('')}
          </div>
        </td>`;

      const expandBtn = row.querySelector('.expand-btn');
      function showDetail() {
        detailRow.hidden = false;
        expandBtn.setAttribute('aria-expanded', 'true');
        expandBtn.textContent = '▼';
        detailRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      expandBtn.addEventListener('click', () => {
        const expanded = expandBtn.getAttribute('aria-expanded') === 'true';
        detailRow.hidden = expanded;
        expandBtn.setAttribute('aria-expanded', String(!expanded));
        expandBtn.textContent = expanded ? '▶' : '▼';
      });

      row.querySelector('.review-answers-btn').addEventListener('click', showDetail);

      row.querySelector('.reset-attempt-btn').addEventListener('click', () => {
        confirmDialog(`Reset ${att.username}'s attempt? They'll be able to retake this quiz.`, async () => {
          const res = await fetch(`/api/rooms/${currentResultsData.code}/attempts/${att.id}`, { method: 'DELETE' });
          if (res.ok) {
            await loadResults(currentResultsData.code, currentResultsData.room.title);
          } else {
            alert('Failed to reset attempt.');
          }
        }, 'Reset');
      });

      detailRow.querySelectorAll('.grade-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const isCorrect = Number(btn.dataset.verdict);
          const res = await fetch(`/api/rooms/${currentResultsData.code}/answers/${btn.dataset.answerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_correct: isCorrect }),
          });
          if (res.ok) {
            await loadResults(currentResultsData.code, currentResultsData.room.title);
          } else {
            alert('Failed to save grade.');
          }
        });
      });

      tbody.appendChild(row);
      tbody.appendChild(detailRow);
    });
  }

  function exportResultsCSV() {
    if (!currentResultsData) return;
    const { code, questions, attempts } = currentResultsData;
    const headers = [
      'username', 'score', 'total', 'pct', 'completed_at',
      ...questions.map((_, i) => `q${i + 1}_answer`),
      ...questions.map((_, i) => `q${i + 1}_correct`),
      ...questions.map((_, i) => `q${i + 1}_grade`),
    ];
    const rows = attempts.map(att => {
      const ansMap = {};
      (att.answers ?? []).forEach(a => { ansMap[a.question_id] = a; });
      const gradeLabel = a => a?.is_correct === null ? 'pending' : a?.is_correct ? 'correct' : 'incorrect';
      return [
        att.username, att.score, att.total,
        `${Math.round((att.score / att.total) * 100)}%`,
        new Date(att.completed_at).toISOString(),
        ...questions.map(q => {
          const a = ansMap[q.id];
          if (!a) return '';
          return q.type === 'free_response' ? (a.response_text ?? '') : String.fromCharCode(65 + a.selected);
        }),
        ...questions.map(q => q.type === 'free_response' ? '' : String.fromCharCode(65 + q.correct)),
        ...questions.map(q => gradeLabel(ansMap[q.id])),
      ];
    });
    // Prefix a leading apostrophe on cells that could be interpreted as a formula
    // by Excel/Sheets (CSV/formula injection) when the file is opened, not just viewed as text.
    const csvSafe = v => /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${csvSafe(String(c)).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `results-${code}.csv`;
    a.click();
  }

  function showSection(section) {
    document.getElementById('createRoomSection').hidden = section !== 'rooms';
    document.getElementById('topicCompletionSection').hidden = section !== 'rooms';
    document.getElementById('questionBankSection').hidden = section !== 'rooms';
    document.getElementById('myRoomsSection').hidden = section !== 'rooms';
    document.getElementById('resultsSection').hidden = section !== 'results';
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────

// ─── Join Room Page ────────────────────────────────────────────
// ─── Profile Page ─────────────────────────────────────────────────────────────

async function initProfilePage() {
  const loginGate = document.getElementById('loginGate');
  const content   = document.getElementById('profileContent');

  if (!currentUser) {
    if (loginGate) loginGate.hidden = false;
    document.getElementById('loginGateBtn')?.addEventListener('click', () => openAuthModal('login'));
    return;
  }

  if (content) content.hidden = false;
  await Promise.all([
    loadProfileAccount(),
    loadProfileProgress(),
  ]);
}

async function initPublicProfilePage() {
  const username = window.location.pathname.replace(/^\/u\//, '');
  const stateEl   = document.getElementById('publicProfileState');
  const iconEl    = document.getElementById('publicProfileIcon');
  const msgEl     = document.getElementById('publicProfileMessage');
  const contentEl = document.getElementById('publicProfileContent');

  const showState = (icon, message) => {
    if (iconEl) iconEl.textContent = icon;
    if (msgEl) msgEl.textContent = message;
    if (stateEl) stateEl.hidden = false;
  };

  try {
    const res = await fetch(`/api/user/${encodeURIComponent(username)}`);
    if (res.status === 404) { showState('❓', 'User not found.'); return; }
    if (res.status === 403) { showState('🔒', 'This profile is private.'); return; }
    if (!res.ok) throw new Error();

    const profile = await res.json();
    document.title = `${profile.username} — CyberUnit @ UNG`;
    const nameHeader = document.getElementById('profileName');
    if (nameHeader) nameHeader.textContent = profile.username;

    const joined = profile.created_at
      ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';

    const accountWrap = document.getElementById('accountWrap');
    if (accountWrap) {
      accountWrap.innerHTML = `
        <div class="profile-account">
          <div class="profile-avatar-col">
            <img class="profile-avatar" src="${escHtml(profile.avatar || DEFAULT_AVATAR)}" alt="Profile picture">
          </div>
          <div class="results-summary-grid">
            <div class="results-stat">
              <span class="results-stat-val" style="font-size:1.1rem;">${escHtml(joined)}</span>
              <span class="results-stat-label">Member Since</span>
            </div>
            ${rankTile(profile.rank, 'Module Rank', '/leaderboard')}
            ${rankTile(profile.roomRank, 'Room Rank', '/leaderboard?mode=rooms')}
          </div>
        </div>`;
    }
    renderProfileBadges(profile.badges ?? []);
    if (contentEl) contentEl.hidden = false;
  } catch {
    showState('⚠️', 'Failed to load this profile.');
  }
}

async function initLeaderboardPage() {
  const gate = document.getElementById('loginGate');
  const content = document.getElementById('leaderboardContent');
  if (!currentUser) {
    if (gate) gate.hidden = false;
    document.getElementById('loginGateBtn')?.addEventListener('click', () => openAuthModal('login'));
    return;
  }
  if (content) content.hidden = false;

  // Wire the mode toggle (Module Completion / Quiz Rooms).
  const btns = [...document.querySelectorAll('.lb-mode-btn')];
  btns.forEach(btn => btn.addEventListener('click', () => {
    if (btn.classList.contains('is-active')) return;
    btns.forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active);
    });
    loadLeaderboard(btn.dataset.mode);
  }));

  // Honour ?mode= from the URL (e.g. the profile "Room Rank" link).
  const initialMode = new URLSearchParams(window.location.search).get('mode') === 'rooms' ? 'rooms' : 'modules';
  btns.forEach(b => {
    const active = b.dataset.mode === initialMode;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active);
  });
  await loadLeaderboard(initialMode);
}

// ─── Member Directory ───────────────────────────────────────────────────────
// Browsable list of opted-in (is_public) profiles. Member-gated (unlike
// Announcements/Events) — same login-gate pattern as /leaderboard.

async function initMembersPage() {
  const gate = document.getElementById('loginGate');
  const content = document.getElementById('membersContent');
  if (!currentUser || currentUser.role === 'guest') {
    if (gate) gate.hidden = false;
    document.getElementById('loginGateBtn')?.addEventListener('click', () => openAuthModal('login'));
    return;
  }
  if (content) content.hidden = false;

  const LIMIT = 20;
  let role = '';
  let page = 1;

  async function loadMembers() {
    const grid = document.getElementById('membersGrid');
    const pagination = document.getElementById('membersPagination');
    if (!grid) return;
    grid.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">Loading...</p>`;
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (role) params.set('role', role);
      const res = await fetch(`/api/members?${params}`);
      if (!res.ok) throw new Error();
      const { members, total } = await res.json();

      grid.innerHTML = members.length
        ? members.map(m => `
          <a href="/u/${encodeURIComponent(m.username)}" class="card card-link" aria-label="${escHtml(m.username)}">
            <img class="lb-avatar" src="${escHtml(m.avatar || DEFAULT_AVATAR)}" alt="" style="width:48px;height:48px;border-radius:50%;margin-bottom:0.5rem;">
            <h3 class="card-title">${escHtml(m.username)}${m.isStudent ? ' <span class="badge badge-beginner">Student</span>' : ''}</h3>
            <p class="card-desc">Member since ${new Date(m.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</p>
            <div class="card-footer">
              <span class="announcement-meta">${m.rank ? `Module Rank #${m.rank}` : 'Unranked (modules)'}${m.roomRank ? ` · Room Rank #${m.roomRank}` : ''}</span>
            </div>
          </a>`).join('')
        : `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No opted-in members match this filter.</p>`;

      if (pagination) {
        const totalPages = Math.max(Math.ceil(total / LIMIT), 1);
        pagination.innerHTML = totalPages > 1 ? `
          <button type="button" class="btn btn-sm" id="membersPrevBtn" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
          <span style="font-family:'Share Tech Mono',monospace;color:var(--text-muted);font-size:0.85rem;">Page ${page} of ${totalPages}</span>
          <button type="button" class="btn btn-sm" id="membersNextBtn" ${page >= totalPages ? 'disabled' : ''}>Next →</button>
        ` : '';
        document.getElementById('membersPrevBtn')?.addEventListener('click', () => { page--; loadMembers(); });
        document.getElementById('membersNextBtn')?.addEventListener('click', () => { page++; loadMembers(); });
      }
    } catch {
      grid.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load the directory.</p>`;
    }
  }

  const filterBar = document.getElementById('memberRoleFilter');
  filterBar?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    for (const c of filterBar.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(c === chip));
    role = chip.dataset.role;
    page = 1;
    loadMembers();
  });

  await loadMembers();
}

// ─── Announcements ──────────────────────────────────────────────────────────

async function initAnnouncementsPage() {
  const content = document.getElementById('announcementsContent');

  // Public page — viewable signed-out, as a guest, or as any member role.
  if (content) content.hidden = false;

  // Clear the unread badge: mark seen server-side, then update the nav
  // in-place so it disappears without needing a page reload. Only signed-in
  // non-guest members carry that badge/endpoint in the first place.
  if (currentUser && currentUser.role !== 'guest' && currentUser.hasUnreadAnnouncements) {
    fetch('/api/announcements/seen', { method: 'POST' }).then(res => {
      if (res.ok) {
        currentUser.hasUnreadAnnouncements = false;
        updateAuthNav();
      }
    }).catch(() => {});
  }

  let allAnnouncements = [];
  const SORT_CYCLE = { newest: 'oldest', oldest: 'az', az: 'za', za: 'newest' };
  const SORT_LABELS = { newest: 'Sort: Newest First', oldest: 'Sort: Oldest First', az: 'Sort: A–Z', za: 'Sort: Z–A' };
  let sortMode = 'newest';
  let openForm = () => {}; // reassigned below when the caller is an admin

  const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  function getSorted(list) {
    const sorted = [...list];
    if (sortMode === 'newest') sorted.sort((a, b) => b.created_at - a.created_at);
    else if (sortMode === 'oldest') sorted.sort((a, b) => a.created_at - b.created_at);
    else if (sortMode === 'az') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === 'za') sorted.sort((a, b) => b.title.localeCompare(a.title));
    return sorted;
  }

  function getFiltered(list, query) {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(a => a.title.toLowerCase().includes(q) || formatDate(a.created_at).toLowerCase().includes(q));
  }

  function render() {
    const wrap = document.getElementById('announcementsList');
    if (!wrap) return;
    const query = document.getElementById('announcementSearch')?.value ?? '';
    const list = getSorted(getFiltered(allAnnouncements, query));
    const isAdmin = currentUser?.role === 'admin';

    if (!allAnnouncements.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No announcements yet.</p>`;
      return;
    }
    if (!list.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No announcements match your search.</p>`;
      return;
    }

    wrap.innerHTML = list.map(a => `
      <div class="card announcement-card">
        <h3 class="card-title">${escHtml(a.title)}</h3>
        <p class="card-desc">${escHtml(a.body)}</p>
        <div class="card-footer announcement-footer">
          <span class="announcement-meta">Posted by ${escHtml(a.username)} — ${formatDate(a.created_at)}${a.updated_at ? ` (edited ${formatDate(a.updated_at)})` : ''}</span>
          ${isAdmin ? `
            <div class="announcement-actions">
              <button type="button" class="btn btn-sm edit-announcement-btn" data-id="${a.id}">Edit</button>
              <button type="button" class="btn btn-sm btn-danger delete-announcement-btn" data-id="${a.id}">Delete</button>
            </div>` : ''}
        </div>
      </div>`).join('');

    if (isAdmin) {
      wrap.querySelectorAll('.edit-announcement-btn').forEach(btn => {
        btn.addEventListener('click', () => openForm(allAnnouncements.find(a => a.id === parseInt(btn.dataset.id, 10))));
      });
      wrap.querySelectorAll('.delete-announcement-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id, 10);
          const a = allAnnouncements.find(x => x.id === id);
          confirmDialog(`Delete "${a?.title ?? 'this announcement'}"? This cannot be undone.`, async () => {
            const res = await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
            if (res.ok) {
              allAnnouncements = allAnnouncements.filter(x => x.id !== id);
              render();
            } else {
              alert('Failed to delete announcement.');
            }
          }, 'Delete');
        });
      });
    }
  }

  async function loadAnnouncements() {
    const wrap = document.getElementById('announcementsList');
    try {
      const res = await fetch('/api/announcements');
      if (!res.ok) throw new Error();
      const { results } = await res.json();
      allAnnouncements = results ?? [];
      render();
    } catch {
      if (wrap) wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load announcements.</p>`;
    }
  }

  // Sort button cycles through the 4 modes.
  const sortBtn = document.getElementById('announcementSortBtn');
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      sortMode = SORT_CYCLE[sortMode];
      sortBtn.textContent = SORT_LABELS[sortMode];
      render();
    });
  }

  // Search filters by title or formatted date as you type.
  document.getElementById('announcementSearch')?.addEventListener('input', render);

  // Admin-only: inline create/edit form.
  if (currentUser?.role === 'admin') {
    const formWrap = document.getElementById('announcementFormWrap');
    if (formWrap) {
      formWrap.hidden = false;
      formWrap.innerHTML = `
        <form id="announcementForm" class="announcement-form">
          <h2 class="instructor-section-heading" id="announcementFormHeading">// New Announcement</h2>
          <p class="form-error" id="announcementFormError" hidden></p>
          <div class="form-group">
            <label for="announcementTitle">Title</label>
            <input type="text" id="announcementTitle" maxlength="200" required>
          </div>
          <div class="form-group">
            <label for="announcementBody">Body</label>
            <textarea id="announcementBody" rows="4" maxlength="5000" required></textarea>
          </div>
          <div class="announcement-form-actions">
            <button type="submit" class="btn btn-primary" id="announcementFormSubmit">Post Announcement</button>
            <button type="button" class="btn btn-sm" id="announcementFormCancel" hidden>Cancel</button>
          </div>
        </form>`;

      let editingId = null;

      openForm = (a) => {
        editingId = a.id;
        document.getElementById('announcementFormHeading').textContent = '// Edit Announcement';
        document.getElementById('announcementTitle').value = a.title;
        document.getElementById('announcementBody').value = a.body;
        document.getElementById('announcementFormSubmit').textContent = 'Save Changes';
        document.getElementById('announcementFormCancel').hidden = false;
        formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };

      function resetForm() {
        editingId = null;
        document.getElementById('announcementForm').reset();
        document.getElementById('announcementFormHeading').textContent = '// New Announcement';
        document.getElementById('announcementFormSubmit').textContent = 'Post Announcement';
        document.getElementById('announcementFormCancel').hidden = true;
      }

      document.getElementById('announcementFormCancel').addEventListener('click', resetForm);

      document.getElementById('announcementForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('announcementFormError');
        errEl.hidden = true;

        const title = document.getElementById('announcementTitle').value.trim();
        const body = document.getElementById('announcementBody').value.trim();
        if (!title || !body) { errEl.textContent = 'Title and body are both required.'; errEl.hidden = false; return; }

        const submitBtn = document.getElementById('announcementFormSubmit');
        submitBtn.disabled = true;
        try {
          const res = await fetch(editingId ? `/api/announcements/${editingId}` : '/api/announcements', {
            method: editingId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body }),
          });
          const data = await res.json();
          if (!res.ok) { errEl.textContent = data.error || 'Failed to save announcement.'; errEl.hidden = false; return; }
          resetForm();
          await loadAnnouncements();
        } finally {
          submitBtn.disabled = false;
        }
      });
    }
  }

  await loadAnnouncements();
}

// ─── Club Events ────────────────────────────────────────────────────────────
// Near-clone of initAnnouncementsPage() above — same public-read/admin-write
// trust model — split into an Upcoming and Past section by comparing each
// event's date to Date.now() at render time (no server-side split needed).

async function initEventsPage() {
  const content = document.getElementById('eventsContent');
  if (content) content.hidden = false;

  let allEvents = [];
  let openForm = () => {}; // reassigned below when the caller is an admin

  const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  function eventCardHtml(e, isAdmin) {
    return `
      <div class="card announcement-card">
        <h3 class="card-title">${escHtml(e.title)}</h3>
        <p class="card-desc">${escHtml(e.description)}</p>
        <div class="card-footer announcement-footer">
          <span class="announcement-meta">${formatDate(e.event_date)}${e.location ? ` — ${escHtml(e.location)}` : ''} · Posted by ${escHtml(e.username)}${e.updated_at ? ` (edited ${formatDate(e.updated_at)})` : ''}</span>
          ${isAdmin ? `
            <div class="announcement-actions">
              <button type="button" class="btn btn-sm edit-event-btn" data-id="${e.id}">Edit</button>
              <button type="button" class="btn btn-sm btn-danger delete-event-btn" data-id="${e.id}">Delete</button>
            </div>` : ''}
        </div>
      </div>`;
  }

  function render() {
    const upcomingWrap = document.getElementById('eventsUpcomingList');
    const pastWrap = document.getElementById('eventsPastList');
    const pastSection = document.getElementById('eventsPastSection');
    if (!upcomingWrap || !pastWrap) return;
    const isAdmin = currentUser?.role === 'admin';

    const now = Date.now();
    const upcoming = allEvents.filter(e => e.event_date >= now).sort((a, b) => a.event_date - b.event_date);
    const past = allEvents.filter(e => e.event_date < now).sort((a, b) => b.event_date - a.event_date);

    upcomingWrap.innerHTML = upcoming.length
      ? upcoming.map(e => eventCardHtml(e, isAdmin)).join('')
      : `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No upcoming events yet.</p>`;

    if (pastSection) pastSection.hidden = past.length === 0;
    pastWrap.innerHTML = past.map(e => eventCardHtml(e, isAdmin)).join('');

    if (isAdmin) {
      document.querySelectorAll('.edit-event-btn').forEach(btn => {
        btn.addEventListener('click', () => openForm(allEvents.find(e => e.id === parseInt(btn.dataset.id, 10))));
      });
      document.querySelectorAll('.delete-event-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id, 10);
          const e = allEvents.find(x => x.id === id);
          confirmDialog(`Delete "${e?.title ?? 'this event'}"? This cannot be undone.`, async () => {
            const res = await fetch(`/api/events/${id}`, { method: 'DELETE' });
            if (res.ok) {
              allEvents = allEvents.filter(x => x.id !== id);
              render();
            } else {
              alert('Failed to delete event.');
            }
          }, 'Delete');
        });
      });
    }
  }

  async function loadEvents() {
    try {
      const res = await fetch('/api/events');
      if (!res.ok) throw new Error();
      const { results } = await res.json();
      allEvents = results ?? [];
      render();
    } catch {
      const wrap = document.getElementById('eventsUpcomingList');
      if (wrap) wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load events.</p>`;
    }
  }

  // Admin-only: inline create/edit form.
  if (currentUser?.role === 'admin') {
    const formWrap = document.getElementById('eventFormWrap');
    if (formWrap) {
      formWrap.hidden = false;
      formWrap.innerHTML = `
        <form id="eventForm" class="announcement-form">
          <h2 class="instructor-section-heading" id="eventFormHeading">// New Event</h2>
          <p class="form-error" id="eventFormError" hidden></p>
          <div class="form-group">
            <label for="eventTitle">Title</label>
            <input type="text" id="eventTitle" maxlength="200" required>
          </div>
          <div class="form-group">
            <label for="eventDate">Date</label>
            <input type="date" id="eventDate" required>
          </div>
          <div class="form-group">
            <label for="eventLocation">Location (optional)</label>
            <input type="text" id="eventLocation" maxlength="200">
          </div>
          <div class="form-group">
            <label for="eventDescription">Description</label>
            <textarea id="eventDescription" rows="4" maxlength="5000" required></textarea>
          </div>
          <div class="announcement-form-actions">
            <button type="submit" class="btn btn-primary" id="eventFormSubmit">Post Event</button>
            <button type="button" class="btn btn-sm" id="eventFormCancel" hidden>Cancel</button>
          </div>
        </form>`;

      let editingId = null;

      openForm = (e) => {
        editingId = e.id;
        document.getElementById('eventFormHeading').textContent = '// Edit Event';
        document.getElementById('eventTitle').value = e.title;
        document.getElementById('eventDate').value = new Date(e.event_date).toISOString().slice(0, 10);
        document.getElementById('eventLocation').value = e.location ?? '';
        document.getElementById('eventDescription').value = e.description;
        document.getElementById('eventFormSubmit').textContent = 'Save Changes';
        document.getElementById('eventFormCancel').hidden = false;
        formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };

      function resetForm() {
        editingId = null;
        document.getElementById('eventForm').reset();
        document.getElementById('eventFormHeading').textContent = '// New Event';
        document.getElementById('eventFormSubmit').textContent = 'Post Event';
        document.getElementById('eventFormCancel').hidden = true;
      }

      document.getElementById('eventFormCancel').addEventListener('click', resetForm);

      document.getElementById('eventForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('eventFormError');
        errEl.hidden = true;

        const title = document.getElementById('eventTitle').value.trim();
        const description = document.getElementById('eventDescription').value.trim();
        const location = document.getElementById('eventLocation').value.trim();
        const event_date = document.getElementById('eventDate').value;
        if (!title || !description || !event_date) { errEl.textContent = 'Title, date, and description are required.'; errEl.hidden = false; return; }

        const submitBtn = document.getElementById('eventFormSubmit');
        submitBtn.disabled = true;
        try {
          const res = await fetch(editingId ? `/api/events/${editingId}` : '/api/events', {
            method: editingId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description, location, event_date }),
          });
          const data = await res.json();
          if (!res.ok) { errEl.textContent = data.error || 'Failed to save event.'; errEl.hidden = false; return; }
          resetForm();
          await loadEvents();
        } finally {
          submitBtn.disabled = false;
        }
      });
    }
  }

  await loadEvents();
}

// ─── Contact Us ─────────────────────────────────────────────────────────────
// Backend stays /api/feedback (unchanged) — only the page-facing name/route
// were renamed to "Contact Us".

function initContactPage() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('contactFormError');
    errEl.hidden = true;

    const message = document.getElementById('contactMessage').value.trim();
    if (!message) { errEl.textContent = 'Please enter a message before sending.'; errEl.hidden = false; return; }

    const submitBtn = document.getElementById('contactFormSubmit');
    submitBtn.disabled = true;
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Failed to send message.'; errEl.hidden = false; return; }

      document.getElementById('contactFormWrap').innerHTML =
        `<p class="card-desc">Thanks — your message has been sent.</p>`;
    } catch {
      errEl.textContent = 'Failed to send message. Please try again.';
      errEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ─── /challenges hub ────────────────────────────────────────────────────────
// The grid itself is server-rendered (crawlers/no-JS see every module); this
// only layers on a per-user completion badge, same progressive-enhancement
// pattern as the homepage topic grid — never wipes the server-rendered cards
// if the fetch fails.
async function initChallengesHub() {
  const cards = document.querySelectorAll('#challengesGrid .card[data-challenge]');
  if (!cards.length || !currentUser) return;

  await Promise.all([...cards].map(async card => {
    const id = card.dataset.challenge;
    const total = parseInt(card.dataset.totalParts, 10) || 0;
    if (!total) return;
    try {
      const res = await fetch(`/api/challenges/${id}/progress`);
      if (!res.ok) return;
      const { completed } = await res.json();
      const done = (completed ?? []).length;
      if (done === 0) return;
      card.classList.toggle('card-completed', done === total);
      const badge = document.createElement('div');
      badge.className = 'card-progress';
      badge.setAttribute('aria-label', `${done} of ${total} challenges complete`);
      badge.innerHTML = `${done}/${total}${done === total ? ' <span class="progress-star" aria-hidden="true">★</span>' : ''}`;
      card.prepend(badge);
    } catch { /* leave the server-rendered card as-is */ }
  }));
}

// ─── Downloadable Challenge Pages (log-analysis-challenge, network-traffic-challenge, ...) ──
// Every such page shares the same #answerKeySection markup — reveal it only
// for instructor/admin. The real gate is server-side (requireRole on
// GET /api/challenges/:id/answer-key); this just controls link visibility.

function initChallengeAnswerKeyToggle() {
  const section = document.getElementById('answerKeySection');
  if (!section) return;
  section.hidden = !isInstructor();
}

// Auto-graded answer submission + persisted completion state for challenge
// pages. Each .lac-challenge card is a "part" (data-part-id); correct
// answers are checked and stored entirely server-side (POST
// /api/challenges/:id/submit) — nothing here knows what the right answer is.
async function initChallengeSubmissions(challengeId) {
  const cards = document.querySelectorAll('.lac-challenge[data-part-id]');
  if (!cards.length) return;

  let completed = new Set();
  if (currentUser) {
    try {
      const res = await fetch(`/api/challenges/${challengeId}/progress`);
      if (res.ok) completed = new Set((await res.json()).completed || []);
    } catch { /* show all as not-yet-completed */ }
  }

  const summary = document.getElementById('challengeProgressSummary');
  const updateSummary = () => {
    if (!summary) return;
    summary.textContent = `[ ${completed.size}/${cards.length} complete ]`;
    summary.hidden = completed.size === 0;
  };
  updateSummary();

  const markCompleted = (submitWrap) => {
    submitWrap.innerHTML = '<p class="lac-completed-badge">✅ Completed</p>';
  };

  cards.forEach((card) => {
    const partId = card.dataset.partId;
    const submitWrap = card.querySelector('.lac-submit');
    if (!submitWrap) return;

    if (completed.has(partId)) {
      markCompleted(submitWrap);
      return;
    }

    const form = submitWrap.querySelector('.lac-answer-form');
    const input = submitWrap.querySelector('.lac-answer-input');
    const feedback = submitWrap.querySelector('.lac-answer-feedback');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentUser) { openAuthModal('login'); return; }

      const answer = input.value.trim();
      if (!answer) return;

      const btn = form.querySelector('button');
      btn.disabled = true;
      feedback.hidden = true;

      try {
        const res = await fetch(`/api/challenges/${challengeId}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partId, answer }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 429) {
          feedback.textContent = data.error || 'Too many attempts — please wait a few minutes.';
          feedback.className = 'lac-answer-feedback lac-answer-feedback--error';
          feedback.hidden = false;
        } else if (res.ok && data.correct) {
          completed.add(partId);
          updateSummary();
          markCompleted(submitWrap);
        } else {
          feedback.textContent = 'Not quite — try again.';
          feedback.className = 'lac-answer-feedback lac-answer-feedback--error';
          feedback.hidden = false;
        }
      } catch {
        feedback.textContent = 'Something went wrong — try again.';
        feedback.className = 'lac-answer-feedback lac-answer-feedback--error';
        feedback.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// ─── Student Hub ────────────────────────────────────────────────────────────

async function initStudentHubPage() {
  const gate = document.getElementById('loginGate');
  const gateMsg = document.getElementById('loginGateMsg');
  const content = document.getElementById('studentHubContent');

  if (!isStudentPlus()) {
    if (gateMsg) {
      gateMsg.textContent = (!currentUser || currentUser.role === 'guest')
        ? 'Sign in with a member account to unlock this — the student role is assigned by an admin.'
        : 'Verified students only — this role is assigned by an admin. Reach out if you think you should have access.';
    }
    if (gate) gate.hidden = false;
    document.getElementById('loginGateBtn')?.addEventListener('click', () => {
      if (!currentUser || currentUser.role === 'guest') openAuthModal('login');
      else window.location.href = '/profile';
    });
    return;
  }

  if (content) content.hidden = false;
  await loadStudentRooms();
}

async function loadStudentRooms() {
  const wrap = document.getElementById('studentRoomsWrap');
  if (!wrap) return;
  try {
    const res = await fetch('/api/rooms/public');
    if (!res.ok) throw new Error();
    const { results } = await res.json();
    const studentRooms = (results ?? []).filter(r => r.visibility === 'student');
    if (!studentRooms.length) {
      wrap.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">No student-only rooms right now.</p>`;
      return;
    }
    wrap.innerHTML = `
      <div class="public-room-grid">
        ${studentRooms.map(r => `
          <div class="room-card">
            <div class="room-card-title">${escHtml(r.title)}</div>
            <div class="room-card-meta">By ${escHtml(r.instructor_name)} · ${r.question_count} question${r.question_count === 1 ? '' : 's'}</div>
            <div class="room-card-footer">
              <code>${escHtml(r.code)}</code>
              <a href="/quiz/${escHtml(r.code)}" class="btn btn-sm">${r.attempted ? 'View Result' : 'Join'}</a>
            </div>
          </div>`).join('')}
      </div>`;
  } catch {
    wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load rooms.</p>`;
  }
}

async function loadLeaderboard(mode = 'modules') {
  const wrap = document.getElementById('leaderboardWrap');
  if (!wrap) return;
  wrap.innerHTML = `<p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;">Loading...</p>`;
  try {
    const res = await fetch(`/api/leaderboard?mode=${encodeURIComponent(mode)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderLeaderboard(data.top ?? [], data.me ?? {}, data.mode ?? mode);
  } catch {
    wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load leaderboard.</p>`;
  }
}

function renderLeaderboard(top, me, mode = 'modules') {
  const wrap = document.getElementById('leaderboardWrap');
  if (!wrap) return;

  const rooms = mode === 'rooms';
  const unit = rooms ? 'room' : 'module';           // singular
  const countLabel = rooms ? 'Rooms' : 'Modules';

  const sub = document.getElementById('lbSubtitle');
  if (sub) sub.textContent = rooms
    ? 'Ranked by total quiz room points'
    : 'Ranked by total module-completion points';

  if (!top.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:2rem 1rem;color:var(--text-muted);font-family:'Share Tech Mono',monospace;background:var(--surface);border:1px solid var(--border);border-radius:6px;">
        <p>No ranked scores yet. ${rooms ? 'Take a quiz room' : 'Complete a topic quiz'} to get on the board!</p>
      </div>`;
    return;
  }

  const medal = r => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`);
  const rows = top.map(row => {
    const isMe = !me.isGuest && row.username === me.username;
    return `
      <tr class="${isMe ? 'lb-me' : ''}">
        <td class="lb-rank">${medal(row.rank)}</td>
        <td class="lb-user">
          <a class="lb-user-cell" href="/u/${encodeURIComponent(row.username)}">
            <img class="lb-avatar" src="${escHtml(row.avatar || DEFAULT_AVATAR)}" alt="">
            <span>${escHtml(row.username)}</span>${isMe ? ' <span class="lb-you">you</span>' : ''}
          </a>
        </td>
        <td class="lb-pts">${row.points}</td>
        <td class="lb-sub">${row.count}</td>
        <td class="lb-sub">${row.perfect}</td>
      </tr>`;
  }).join('');

  const meInTop = !me.isGuest && top.some(r => r.username === me.username);
  const footer = me.isGuest
    ? `<p class="lb-footnote">Guest scores aren't ranked — create an account to compete.</p>`
    : (meInTop ? '' : `<p class="lb-footnote">You: <strong>${me.points}</strong> point${me.points === 1 ? '' : 's'} across ${me.count} ${unit}${me.count === 1 ? '' : 's'} — keep going to climb the board!</p>`);

  wrap.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="lb-table">
        <thead>
          <tr><th>Rank</th><th>User</th><th>Points</th><th>${countLabel}</th><th>★ Perfect</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${footer}`;
}

// Shared rank tile used on both the owner's profile and public profile views.
function rankTile(rank, label, href) {
  const tier = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  const disp = rank ? `${rank === 1 ? '👑 ' : ''}#${rank}` : 'Unranked';
  return `
          <a href="${href}" class="results-stat results-stat--link ${tier ? 'pf-rank pf-rank--' + tier : ''}" aria-label="${label} — open the leaderboard">
            <span class="results-stat-val">${disp}</span>
            <span class="results-stat-label">${label} ↗</span>
          </a>`;
}

async function loadProfileAccount() {
  const accountWrap = document.getElementById('accountWrap');
  const historyWrap = document.getElementById('roomHistoryWrap');
  if (!accountWrap) return;
  try {
    const res = await fetch('/api/profile');
    if (!res.ok) throw new Error();
    const profile = await res.json();

    const joined = profile.created_at
      ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';
    const displayName = profile.role === 'guest' ? 'Guest' : profile.username;
    const nameHeader = document.getElementById('profileName');
    if (nameHeader) nameHeader.textContent = displayName;

    accountWrap.innerHTML = `
      <div class="profile-account">
        <div class="profile-avatar-col">
          <img class="profile-avatar" id="profileAvatar" src="${escHtml(profile.avatar || DEFAULT_AVATAR)}" alt="Profile picture">
          <div class="profile-avatar-actions">
            <input type="file" id="avatarInput" accept="image/*" hidden>
            <button class="btn btn-sm" id="avatarChangeBtn">Change Picture</button>
            <button class="btn btn-sm" id="avatarRemoveBtn" ${profile.avatar ? '' : 'hidden'}>Remove</button>
          </div>
          <p class="form-error" id="avatarError" aria-live="polite" hidden></p>
        </div>
        <div class="results-summary-grid">
          <div class="results-stat">
            <span class="results-stat-val">${escHtml(profile.role)}</span>
            <span class="results-stat-label">Role</span>
          </div>
          <div class="results-stat">
            <span class="results-stat-val" style="font-size:1.1rem;">${escHtml(joined)}</span>
            <span class="results-stat-label">Member Since</span>
          </div>
          ${rankTile(profile.rank, 'Module Rank', '/leaderboard')}
          ${rankTile(profile.roomRank, 'Room Rank', '/leaderboard?mode=rooms')}
        </div>
        ${profile.role !== 'guest' ? `
        <div class="profile-visibility">
          <label class="visibility-toggle">
            <input type="checkbox" id="visibilityToggle" ${profile.isPublic ? 'checked' : ''} aria-describedby="visibilityStatusText">
            <span class="visibility-toggle-slider" aria-hidden="true"></span>
          </label>
          <span class="visibility-toggle-copy">
            <strong>Public profile</strong>
            <span id="visibilityStatusText">${profile.isPublic
              ? `Viewable at <code>/u/${escHtml(profile.username)}</code> and listed in the <a href="/members">Member Directory</a>`
              : 'Only you can see your profile'}</span>
          </span>
        </div>
        <div class="profile-discord">
          <strong>Discord</strong>
          <span id="discordStatusText">${profile.discordLinked
            ? `Linked as <code>${escHtml(profile.discordUsername)}</code>`
            : 'Not linked'}</span>
          ${profile.discordLinked
            ? '<button type="button" class="btn btn-sm" id="discordUnlinkBtn">Unlink</button>'
            : '<a class="btn btn-sm" href="/api/discord/link/start" id="discordLinkBtn">Link Discord</a>'}
        </div>` : ''}
      </div>`;

    wireAvatarControls();
    wireVisibilityToggle(profile.username);
    wireDiscordControls();
    renderProfileRoomHistory(profile.roomAttempts ?? []);
    renderProfileBadges(profile.badges ?? []);
    renderEmailVerification(profile);
    renderDiscordBanner();
  } catch {
    accountWrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load account info.</p>`;
    if (historyWrap) historyWrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load quiz room history.</p>`;
  }
}

// ─── Email Verification ─────────────────────────────────────────────────────

function renderEmailVerification(profile) {
  const wrap = document.getElementById('emailVerifyWrap');
  if (!wrap) return;

  const params = new URLSearchParams(window.location.search);
  const banner = document.getElementById('emailVerifyBanner');
  if (banner && !banner.dataset.shown) {
    if (params.get('verified') === '1') {
      banner.textContent = '✅ Your email is verified!';
      banner.style.color = 'var(--accent)';
      banner.hidden = false;
      banner.dataset.shown = '1';
    } else if (params.get('verify_error') === '1') {
      banner.textContent = 'That verification link is invalid or has expired. Please request a new one below.';
      banner.hidden = false;
      banner.dataset.shown = '1';
    } else if (params.get('reset') === '1') {
      banner.textContent = '✅ Your password has been reset.';
      banner.style.color = 'var(--accent)';
      banner.hidden = false;
      banner.dataset.shown = '1';
    }
  }

  if (profile.email) {
    wrap.innerHTML = `
      <p>✓ <strong>Email verified</strong></p>
      <p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;font-size:0.85rem;">${escHtml(profile.email)}</p>`;
    return;
  }

  if (profile.emailPending) {
    wrap.innerHTML = `
      <p>Verification email sent to <strong>${escHtml(profile.emailPending)}</strong> — check your inbox.</p>
      <p class="form-error" id="emailVerifyError" hidden></p>
      <div class="announcement-form-actions">
        <button type="button" class="btn btn-sm" id="emailVerifyResendBtn">Resend</button>
        <button type="button" class="link-btn" id="emailVerifyChangeBtn">Use a different email</button>
      </div>`;
    document.getElementById('emailVerifyResendBtn')?.addEventListener('click', () => submitEmailVerify(profile.emailPending));
    // Wrong address, typo, whatever — let them enter a new one. The request
    // endpoint already overwrites email_pending on each call (still subject
    // to the same per-account cooldown), so this just needs to show the
    // input again rather than being stuck on the address already sent to.
    document.getElementById('emailVerifyChangeBtn')?.addEventListener('click', () => renderEmailVerifyForm(wrap));
    return;
  }

  renderEmailVerifyForm(wrap);
}

function renderEmailVerifyForm(wrap) {
  wrap.innerHTML = `
    <form id="emailVerifyForm" class="announcement-form">
      <p class="form-error" id="emailVerifyError" hidden></p>
      <div class="form-group">
        <label for="emailVerifyEmail">Your email</label>
        <input type="email" id="emailVerifyEmail" placeholder="you@example.com" required>
      </div>
      <div class="announcement-form-actions">
        <button type="submit" class="btn btn-primary" id="emailVerifySubmit">Send Verification Email</button>
      </div>
    </form>`;
  document.getElementById('emailVerifyForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitEmailVerify(document.getElementById('emailVerifyEmail').value.trim());
  });
}

async function submitEmailVerify(email) {
  const errEl = document.getElementById('emailVerifyError');
  const btn = document.getElementById('emailVerifySubmit') || document.getElementById('emailVerifyResendBtn');
  if (errEl) errEl.hidden = true;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/auth/verify-email/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (errEl) { errEl.textContent = data.error || 'Failed to send verification email.'; errEl.hidden = false; }
      return;
    }
    await loadProfileAccount();
  } catch {
    if (errEl) { errEl.textContent = 'Failed to send verification email.'; errEl.hidden = false; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderProfileBadges(badges) {
  const wrap = document.getElementById('badgesWrap');
  if (!wrap) return;
  const earnedCount = badges.filter(b => b.earned).length;
  wrap.innerHTML = `
    <p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;font-size:0.85rem;margin:0 0 1rem;">
      ${earnedCount} of ${badges.length} badges earned — click one to jump to its stage
    </p>
    <div class="pf-badges">
      ${badges.map(b => {
        const tip = b.earned
          ? `Earned — you completed Stage ${b.num}: ${escHtml(b.stageTitle)}`
          : `Locked — complete Stage ${b.num}: ${escHtml(b.stageTitle)} to earn this`;
        return `
        <a href="${escHtml(b.href)}" class="pf-badge ${b.earned ? 'is-earned' : 'is-locked'}" aria-label="${escHtml(b.name)}. ${tip}">
          <span class="pf-badge-icon" aria-hidden="true">${b.icon}</span>
          <span class="pf-badge-name">${escHtml(b.name)}</span>
          <span class="pf-badge-tip" role="tooltip">${tip}</span>
        </a>`;
      }).join('')}
    </div>`;
}

function wireVisibilityToggle(username) {
  const toggle = document.getElementById('visibilityToggle');
  const statusText = document.getElementById('visibilityStatusText');
  if (!toggle) return;

  toggle.addEventListener('change', async () => {
    const isPublic = toggle.checked;
    toggle.disabled = true;
    try {
      const res = await fetch('/api/profile/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (statusText) {
        statusText.innerHTML = data.isPublic
          ? `Viewable at <code>/u/${escHtml(username)}</code> and listed in the <a href="/members">Member Directory</a>`
          : 'Only you can see your profile';
      }
    } catch {
      toggle.checked = !isPublic; // revert on failure
      if (statusText) statusText.textContent = 'Could not update — please try again.';
    } finally {
      toggle.disabled = false;
    }
  });
}

// The "Link Discord" control is a plain `<a href>` navigating to
// /api/discord/link/start (must be a real top-level navigation, not a
// fetch() — Discord's own login/consent page can't render inside an XHR
// response), so there's nothing to wire for it. Only "Unlink" needs a
// listener.
function wireDiscordControls() {
  const unlinkBtn = document.getElementById('discordUnlinkBtn');
  if (!unlinkBtn) return;

  unlinkBtn.addEventListener('click', async () => {
    unlinkBtn.disabled = true;
    try {
      const res = await fetch('/api/discord/unlink', { method: 'POST' });
      if (!res.ok) throw new Error();
      await loadProfileAccount(); // re-render the Discord section back to "Not linked"
    } catch {
      const statusText = document.getElementById('discordStatusText');
      if (statusText) statusText.textContent = 'Could not unlink — please try again.';
      unlinkBtn.disabled = false;
    }
  });
}

// Handles the ?discord=linked / ?discord=error / ?discord=duplicate landing
// state from /api/discord/callback's redirect, reusing the same generic
// feedback banner element as renderEmailVerification's verified/reset
// states. Strips the query param afterward so a page refresh doesn't
// re-show a stale banner.
function renderDiscordBanner() {
  const banner = document.getElementById('emailVerifyBanner');
  if (!banner || banner.dataset.shown) return;

  const params = new URLSearchParams(window.location.search);
  const discord = params.get('discord');
  if (!discord) return;

  if (discord === 'linked') {
    banner.textContent = '✅ Discord linked!';
    banner.style.color = 'var(--accent)';
  } else if (discord === 'duplicate') {
    banner.textContent = 'That Discord account is already linked to a different member.';
  } else {
    banner.textContent = 'Something went wrong linking Discord — please try again.';
  }
  banner.hidden = false;
  banner.dataset.shown = '1';

  params.delete('discord');
  const newSearch = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''));
}

function wireAvatarControls() {
  const input     = document.getElementById('avatarInput');
  const changeBtn = document.getElementById('avatarChangeBtn');
  const removeBtn = document.getElementById('avatarRemoveBtn');
  const img       = document.getElementById('profileAvatar');
  const errorEl   = document.getElementById('avatarError');
  if (!input || !changeBtn || !img) return;

  const showError = msg => { if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; } };
  const clearError = () => { if (errorEl) errorEl.hidden = true; };

  const applyAvatar = avatar => {
    img.src = avatar || DEFAULT_AVATAR;
    if (removeBtn) removeBtn.hidden = !avatar;
    if (currentUser) currentUser.avatar = avatar;
    updateAuthNav();
  };

  changeBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    clearError();
    changeBtn.disabled = true;
    try {
      const dataUrl = await resizeAvatarImage(file);
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      applyAvatar(data.avatar);
    } catch (err) {
      showError(err.message || 'Upload failed.');
    } finally {
      changeBtn.disabled = false;
    }
  });

  removeBtn?.addEventListener('click', () => {
    confirmDialog('Remove your profile picture and go back to the default?', async () => {
      clearError();
      try {
        const res = await fetch('/api/profile/avatar', { method: 'DELETE' });
        if (!res.ok) throw new Error();
        applyAvatar(null);
      } catch {
        showError('Failed to remove picture.');
      }
    }, 'Remove');
  });
}

// Crop-to-square and downscale a chosen image file, returning a small data URL.
// Accepts any format the browser can decode (PNG, JPEG, WebP, GIF, BMP, AVIF,
// SVG, ICO, ...) since the result is always re-encoded to WebP/JPEG anyway.
function resizeAvatarImage(file) {
  return new Promise((resolve, reject) => {
    // Some platforms report an empty type for less common formats (e.g. HEIC),
    // so only reject when the type is present and clearly not an image.
    if (file.type && !file.type.startsWith('image/')) {
      return reject(new Error('That file is not an image.'));
    }
    if (file.size > 8 * 1024 * 1024) {
      return reject(new Error('Image too large (max 8MB).'));
    }
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      if (!img.naturalWidth || !img.naturalHeight) {
        return reject(new Error('Could not determine the image dimensions.'));
      }
      const SIZE = 256;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
      let dataUrl;
      try {
        dataUrl = canvas.toDataURL('image/webp', 0.85);
        if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      } catch {
        return reject(new Error('Could not process that image.'));
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error(`This browser can't read that image format${file.type ? ` (${file.type})` : ''}. Try a PNG or JPEG.`));
    };
    img.src = URL.createObjectURL(file);
  });
}

function renderProfileRoomHistory(attempts) {
  const wrap = document.getElementById('roomHistoryWrap');
  if (!wrap) return;
  if (!attempts.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:2rem 1rem;color:var(--text-muted);font-family:'Share Tech Mono',monospace;background:var(--surface);border:1px solid var(--border);border-radius:6px;">
        <p>No quiz room attempts yet. <a href="/quiz">Join a room</a> to get started.</p>
      </div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="public-room-grid">
      ${attempts.map(a => {
        const pct = a.total > 0 ? Math.round((a.score / a.total) * 100) : 0;
        const pendingBadge = a.pending > 0
          ? ` <span class="status-badge status-open" title="Awaiting instructor review">${a.pending} pending</span>`
          : '';
        const when = new Date(a.completed_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        return `
        <div class="room-card">
          <div class="room-card-title">${escHtml(a.title)}</div>
          <div class="room-card-meta">${a.score}/${a.total} (${pct}%)${pendingBadge} · ${escHtml(when)}</div>
          <div class="room-card-footer">
            <code>${escHtml(a.code)}</code>
            <a href="/quiz/${escHtml(a.code)}" class="btn btn-sm">View Result</a>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

async function loadProfileProgress() {
  const wrap = document.getElementById('progressWrap');
  if (!wrap) return;
  try {
    const [topicsRes, progressRes] = await Promise.all([
      fetch('/api/topics'),
      fetch('/api/progress'),
    ]);
    if (!topicsRes.ok || !progressRes.ok) throw new Error();
    const topics = await topicsRes.json();
    const { results } = await progressRes.json();

    const progressMap = {};
    for (const r of (results ?? [])) progressMap[r.topic_id] = r;
    const completed = topics.filter(t => progressMap[t.id]).length;

    wrap.innerHTML = `
      <p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;font-size:0.85rem;margin:0 0 1rem;">
        ${completed} of ${topics.length} topic quizzes completed
      </p>
      <div class="topic-grid">
        ${topics.map(t => {
          const prog = progressMap[t.id];
          const progressBadge = prog
            ? `<div class="card-progress" aria-label="Quiz score: ${prog.score} of ${prog.total}">
                 ${prog.score}/${prog.total}${prog.score === prog.total ? ' <span class="progress-star" aria-hidden="true">★</span>' : ''}
               </div>`
            : '';
          return `
            <a href="/topic/${t.id}" class="card card-link${prog ? ' card-completed' : ''}" aria-label="${escHtml(t.title)}">
              ${progressBadge}
              <div class="card-icon" aria-hidden="true">${t.icon}</div>
              <h3 class="card-title">${escHtml(t.title)}</h3>
              <p class="card-desc">${escHtml(t.shortDesc)}</p>
              <div class="card-footer">
                <span class="badge badge-${t.difficulty.toLowerCase()}">${escHtml(t.difficulty)}</span>
                <span class="btn btn-sm" aria-hidden="true">Explore →</span>
              </div>
            </a>`;
        }).join('')}
      </div>`;
  } catch {
    wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">Failed to load progress.</p>`;
  }
}

async function initJoinRoom() {
  const loginGate  = document.getElementById('loginGate');
  const joinContent = document.getElementById('joinContent');

  if (!currentUser) {
    if (loginGate) loginGate.hidden = false;
    document.getElementById('loginGateBtn')?.addEventListener('click', () => openAuthModal('login'));
    return;
  }

  if (joinContent) joinContent.hidden = false;
  await loadPublicRooms();
  initRoomCodeEntry();
}

async function loadPublicRooms() {
  const wrap = document.getElementById('publicRoomsWrap');
  if (!wrap) return;
  const showMsg = text => {
    wrap.innerHTML = `<p style="color:var(--danger);font-family:'Share Tech Mono',monospace;">${text}</p>`;
  };
  try {
    const res = await fetch('/api/rooms/public');
    // Guests are blocked server-side (member+ only) — give them a clear reason.
    if (res.status === 403 || currentUser?.role === 'guest') {
      showMsg('Cannot view public rooms as guest.');
      return;
    }
    if (!res.ok) throw new Error();
    const { results } = await res.json();
    renderPublicRooms(results ?? []);
  } catch {
    showMsg('Failed to load public rooms.');
  }
}

function renderPublicRooms(rooms) {
  const wrap = document.getElementById('publicRoomsWrap');
  if (!rooms.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);font-family:'Share Tech Mono',monospace;background:var(--surface);border:1px solid var(--border);border-radius:6px;">
        <p style="font-size:2rem;margin-bottom:0.75rem;">📋</p>
        <p>No public rooms right now. Check back later or ask your instructor for a room code.</p>
      </div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="public-room-grid">
      ${rooms.map(r => `
        <div class="room-card">
          <div class="room-card-title">${escHtml(r.title)}${r.visibility === 'student' ? ' <span class="status-badge status-student">Student Only</span>' : ''}</div>
          <div class="room-card-meta">By ${escHtml(r.instructor_name)} · ${r.question_count} question${r.question_count === 1 ? '' : 's'}</div>
          <div class="room-card-footer">
            <code>${escHtml(r.code)}</code>
            <a href="/quiz/${escHtml(r.code)}" class="btn btn-sm">${r.attempted ? 'View Result' : 'Join'}</a>
          </div>
        </div>`).join('')}
    </div>`;
}

function initRoomCodeEntry() {
  const form    = document.getElementById('quizEntryForm');
  const input   = document.getElementById('roomCodeInput');
  const errorEl = document.getElementById('quizEntryError');
  if (!form || !input) return;

  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    input.value = input.value.toUpperCase();
    input.setSelectionRange(pos, pos);
    if (errorEl) errorEl.hidden = true;
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const raw = input.value.trim().toUpperCase().replace(/\s/g, '');
    if (!raw) { showEntryError('Please enter a room code.'); return; }
    let code = raw;
    if (/^[A-Z0-9]{8}$/.test(code)) code = `${code.slice(0, 4)}-${code.slice(4)}`;
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
      showEntryError('Invalid code format. Expected XXXX-XXXX.');
      return;
    }
    window.location.href = `/quiz/${code}`;
  });

  function showEntryError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
}

// ─── Quiz Room Page ──────────────────────────────────────────────
async function initQuizRoom() {
  const code = window.location.pathname.replace(/^\/quiz\//i, '').toUpperCase();
  if (!code || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    window.location.replace('/quiz');
    return;
  }

  if (!currentUser) {
    showRoomError('You must be signed in to join a quiz room.');
    openAuthModal('login');
    return;
  }

  showRoomState('loading');

  let data;
  try {
    const res = await fetch(`/api/rooms/${code}/join`);
    data = await res.json();
    if (!res.ok) { showRoomError(data.error || 'Unable to join room.'); return; }
  } catch {
    showRoomError('Failed to load quiz room. Check your connection and try again.');
    return;
  }

  document.title = `CyberUnit @ UNG — ${data.room.title}`;

  if (data.alreadyAttempted) {
    showRoomState('results');
    renderRoomResults(data.attempt, data.room, true);
  } else {
    const titleEl = document.getElementById('roomTitleEl');
    const codeEl  = document.getElementById('roomCodeEl');
    if (titleEl) titleEl.textContent = data.room.title;
    if (codeEl)  codeEl.textContent  = `Code: ${code}`;
    showRoomState('active');
    renderRoomQuiz(data.questions, code, data.room);
  }
}

function showRoomState(state) {
  ['Loading', 'Active', 'Results', 'Error'].forEach(s => {
    const el = document.getElementById(`quizRoom${s}`);
    if (el) el.hidden = s.toLowerCase() !== state;
  });
}

function showRoomError(message) {
  showRoomState('error');
  const el = document.getElementById('quizRoomErrorMsg');
  if (el) el.textContent = message;
}

function renderRoomQuiz(questions, code, room) {
  const container = document.getElementById('roomQuizContainer');
  const submitBtn = document.getElementById('roomSubmitBtn');
  const progressEl = document.getElementById('roomProgress');
  const hintEl    = document.getElementById('roomSubmitHint');
  if (!container || !submitBtn) return;

  const total      = questions.length;
  const selections = new Array(total).fill(null);

  function isAnswered(qi) {
    const s = selections[qi];
    if (s === null) return false;
    return typeof s === 'string' ? s.trim().length > 0 : true;
  }

  function updateProgress() {
    const answered  = questions.filter((_, qi) => isAnswered(qi)).length;
    const remaining = total - answered;
    if (progressEl) progressEl.textContent = `${answered} / ${total} answered`;
    if (hintEl) hintEl.textContent = remaining > 0
      ? `${remaining} question${remaining !== 1 ? 's' : ''} remaining`
      : 'All questions answered — ready to submit!';
    submitBtn.disabled = answered < total;
  }

  container.innerHTML = questions.map((q, qi) => q.type === 'free_response' ? `
    <div class="quiz-box" id="rquiz-${qi}">
      <p class="quiz-question">${qi + 1}. ${escHtml(q.question)}</p>
      <textarea class="quiz-free-response" data-qi="${qi}" rows="4" maxlength="5000"
        placeholder="Type your answer..." aria-label="Answer for question ${qi + 1}"></textarea>
    </div>` : `
    <div class="quiz-box" id="rquiz-${qi}">
      <p class="quiz-question">${qi + 1}. ${escHtml(q.question)}</p>
      <div class="quiz-options" role="group" aria-label="Answer choices for question ${qi + 1}">
        ${q.answers.map((ans, ai) => `
          <button class="quiz-option"
            data-qi="${qi}" data-ai="${ai}"
            aria-pressed="false"
            aria-label="Option ${String.fromCharCode(65 + ai)}: ${escHtml(ans)}">
            <strong>${String.fromCharCode(65 + ai)})</strong> ${escHtml(ans)}
          </button>`).join('')}
      </div>
    </div>`).join('');

  container.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const qi = parseInt(btn.dataset.qi, 10);
      const ai = parseInt(btn.dataset.ai, 10);
      container.querySelectorAll(`[data-qi="${qi}"].quiz-option`).forEach(b => {
        b.classList.remove('room-selected');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('room-selected');
      btn.setAttribute('aria-pressed', 'true');
      selections[qi] = ai;
      updateProgress();
    });
  });

  container.querySelectorAll('.quiz-free-response').forEach(textarea => {
    textarea.addEventListener('input', () => {
      const qi = parseInt(textarea.dataset.qi, 10);
      selections[qi] = textarea.value;
      updateProgress();
    });
  });

  updateProgress();

  submitBtn.addEventListener('click', async () => {
    if (questions.some((_, qi) => !isAnswered(qi))) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    let result;
    try {
      const res = await fetch(`/api/rooms/${code}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: selections }),
      });
      result = await res.json();
      if (!res.ok) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Quiz';
        alert(result.error || 'Failed to submit quiz. Please try again.');
        return;
      }
    } catch {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Quiz';
      alert('Network error. Your answers were not saved — please try again.');
      return;
    }

    showRoomState('results');
    renderRoomResults(result, room, false);
  }, { once: true });
}

function renderRoomResults(attempt, room, wasAlreadyAttempted) {
  const container = document.getElementById('quizRoomResults');
  if (!container) return;

  const pendingCount = attempt.pendingCount ?? (attempt.answers ?? []).filter(a => a.is_correct === null).length;
  const pct     = Math.round((attempt.score / attempt.total) * 100);
  const perfect = attempt.score === attempt.total;
  const passing = attempt.score / attempt.total >= 0.7;
  const color   = perfect ? 'var(--accent)' : passing ? 'var(--warn)' : 'var(--danger)';
  const msg     = pendingCount > 0 ? 'Tentative score — pending review' : perfect ? 'Perfect score!' : passing ? 'Good work!' : 'Keep studying!';

  const answerRows = (attempt.answers ?? []).map((a, i) => {
    if (a.type === 'free_response') {
      const pending = a.is_correct === null;
      const isCorrect = !!a.is_correct;
      const boxClass = pending ? 'result-pending' : (isCorrect ? 'result-correct' : 'result-wrong');
      const icon = pending ? '⋯' : (isCorrect ? '✓' : '✗');
      const feedback = !pending && a.explanation
        ? `<div class="quiz-feedback ${isCorrect ? 'correct' : 'wrong'}" style="display:block;">
            ${isCorrect ? `✓ Correct! ${escHtml(a.explanation)}` : `✗ Not quite. ${escHtml(a.explanation)}`}
          </div>`
        : '';
      return `<div class="quiz-box room-result-box ${boxClass}">
        <p class="quiz-question"><span class="result-icon">${icon}</span>${i + 1}. ${escHtml(a.question)}</p>
        <div class="quiz-free-response-display">${escHtml(a.response_text || '(no answer submitted)')}</div>
        ${pending ? `<div class="quiz-pending-badge">Pending instructor review</div>` : feedback}
      </div>`;
    }

    const isCorrect = !!a.is_correct;
    const opts = (a.answers ?? []).map((ans, ai) => {
      let cls = 'quiz-option';
      if (ai === a.correct) cls += ' correct';
      else if (ai === a.selected && !isCorrect) cls += ' wrong';
      return `<button class="${cls}" disabled aria-label="${escHtml(ans)}">
        <strong>${String.fromCharCode(65 + ai)})</strong> ${escHtml(ans)}
      </button>`;
    }).join('');
    const feedback = a.explanation
      ? `<div class="quiz-feedback ${isCorrect ? 'correct' : 'wrong'}" style="display:block;">
          ${isCorrect
            ? `✓ Correct! ${escHtml(a.explanation)}`
            : `✗ Not quite. The answer is <strong>${String.fromCharCode(65 + a.correct)}</strong>. ${escHtml(a.explanation)}`}
        </div>`
      : '';
    return `<div class="quiz-box room-result-box ${isCorrect ? 'result-correct' : 'result-wrong'}">
      <p class="quiz-question">
        <span class="result-icon">${isCorrect ? '✓' : '✗'}</span>${i + 1}. ${escHtml(a.question)}
      </p>
      <div class="quiz-options" style="pointer-events:none;">${opts}</div>
      ${feedback}
    </div>`;
  }).join('');

  container.innerHTML = `
    <header class="room-results-header">
      <h1 style="font-family:'Share Tech Mono',monospace;color:var(--accent);font-size:1.3rem;margin:0 0 0.25rem;">// Results</h1>
      <p style="color:var(--text-muted);font-family:'Share Tech Mono',monospace;font-size:0.82rem;margin:0;">${escHtml(room?.title ?? '')}</p>
    </header>
    ${wasAlreadyAttempted ? `<div class="room-already-banner">You already completed this quiz — here's how you did:</div>` : ''}
    ${pendingCount > 0 ? `<div class="room-already-banner room-pending-banner">Tentative score — ${pendingCount} free-response question${pendingCount !== 1 ? 's' : ''} awaiting instructor review. Your score may change.</div>` : ''}
    <div class="room-score-card">
      <div class="room-score-num" style="color:${color};">${attempt.score} / ${attempt.total}</div>
      <div class="room-score-pct" style="color:${color};">${pct}%</div>
      <div class="room-score-msg">${msg}</div>
    </div>
    ${answerRows}
    <a href="/quiz" class="btn btn-sm" style="margin-top:1.5rem;">Back to Join Room</a>`;

  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('DOMContentLoaded', async () => {
  initHamburger();
  initScrollPerf();
  initSmoothScroll();
  await initAuth();

  if (isHomePage()) {
    initTypewriter();
    initDifficultyFilter();
    renderTopicGrid();
  } else if (window.location.pathname.startsWith('/topic/')) {
    renderTopicPage();
  } else if (window.location.pathname === '/quiz') {
    initJoinRoom();
  } else if (window.location.pathname === '/profile') {
    initProfilePage();
  } else if (window.location.pathname === '/leaderboard') {
    initLeaderboardPage();
  } else if (window.location.pathname === '/members') {
    initMembersPage();
  } else if (window.location.pathname === '/announcements') {
    initAnnouncementsPage();
  } else if (window.location.pathname === '/events') {
    initEventsPage();
  } else if (window.location.pathname.startsWith('/u/')) {
    initPublicProfilePage();
  } else if (window.location.pathname.startsWith('/quiz/')) {
    initQuizRoom();
  } else if (window.location.pathname === '/instructor') {
    initInstructorPanel();
  } else if (window.location.pathname === '/admin') {
    initAdminPanel();
  } else if (window.location.pathname === '/contact') {
    initContactPage();
  } else if (window.location.pathname === '/student-hub') {
    initStudentHubPage();
  } else if (window.location.pathname === '/log-analysis-challenge') {
    initChallengeAnswerKeyToggle();
    initChallengeSubmissions('log-analysis-regex');
  } else if (window.location.pathname === '/network-traffic-challenge') {
    initChallengeAnswerKeyToggle();
    initChallengeSubmissions('wireshark-nta');
  } else if (window.location.pathname === '/challenges') {
    initChallengesHub();
  } else if (/^\/challenges\/[\w-]+$/.test(window.location.pathname)) {
    // Generic module page — the challenge id is server-injected into
    // <body data-challenge-id>, so this one branch covers every new-style
    // module instead of needing an else-if per module like the two legacy
    // pages above.
    const challengeId = document.body.dataset.challengeId;
    if (challengeId) {
      initChallengeAnswerKeyToggle();
      initChallengeSubmissions(challengeId);
    }
  }
});
