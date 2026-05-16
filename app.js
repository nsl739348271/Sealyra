/* ============================================================
   Her Little Lexicon — app.js
   Logic ONLY. No visual styling.

   Mental model:
     • Cover is the hub. Title + Tonight's Reading + counter +
       (her note) + (the index). nothing else lives on cover.
     • Game flow is strictly linear, three stages:
         stage1: the matching   (4 pairs, 8 cards)
         stage2: the reading    (8 multiple-choice questions)
         stage3: the inscription (8 dictations)
       After each stage → result screen → "next" (pink) or
       "back to cover" (ghost). After stage3 → summary → cover.
     • Auto-advance: oracle correct + dict correct + dict-after-
       rewrite all auto-advance without a button.
     • note / index are cover-side pages, NOT in the game flow.
   ============================================================ */

/* ------------------------------------------------------------
   0. UTILITIES
   ------------------------------------------------------------ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function escapeHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }

function speak(text, lang = 'en-US') {
  if (!window.speechSynthesis) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.92;
    u.pitch = 1.0;
    u.onend   = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

/* ------------------------------------------------------------
   1. SFX — one bank, named by ROLE (so re-skinning sound is one place)
   Roles:
     bling   — entering a game (Tonight's Reading tap, stage→stage)
     tap     — generic UI tap (default button, ghost button)
     pageTurn— opening a vocab card (tarot flip)
     pop     — modal appears
     right   — correct answer (oracle / dict)
     wrong   — wrong answer
     finish  — chapter finished
   ------------------------------------------------------------ */
const SFX = (() => {
  let ctx = null;
  const ensure = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; };

  function tone(freqs, gap = 0.06, dur = 0.18, type = 'sine', peak = 0.16) {
    const c = ensure();
    const t0 = c.currentTime;
    freqs.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t0 + i * gap);
      g.gain.setValueAtTime(0.0001, t0 + i * gap);
      g.gain.exponentialRampToValueAtTime(peak, t0 + i * gap + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * gap + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0 + i * gap);
      o.stop(t0 + i * gap + dur + 0.05);
    });
  }
  function noise(dur = 0.18, peak = 0.08, hp = 1800) {
    const c = ensure();
    const bufferSize = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = hp;
    const g = c.createGain(); g.gain.value = peak;
    src.connect(filter); filter.connect(g); g.connect(c.destination);
    src.start(c.currentTime);
  }
  return {
    bling:   () => {
      // Ascending chime …
      tone([1175, 1568, 1976, 2349, 2794], 0.05, 0.32, 'triangle', 0.13);
      // … with a shimmer chord layered ~80ms later …
      setTimeout(() => tone([2349, 2794, 3136], 0.04, 0.22, 'sine', 0.08), 80);
      // … and a final tiny sparkle.
      setTimeout(() => tone([3520, 4186], 0.04, 0.14, 'sine', 0.05), 200);
    },
    tap:     () => tone([1050],                          0.0, 0.07, 'sine',     0.06),
    pageTurn:() => { noise(0.18, 0.06, 2200); },
    pop:     () => tone([784, 1175, 1568],               0.06, 0.22, 'triangle', 0.12),
    right:   () => tone([880, 1175, 1568],               0.05, 0.22, 'sine',     0.16),
    wrong:   () => tone([311, 207],                      0.07, 0.20, 'square',   0.06),
    finish:  () => tone([523, 659, 784, 988, 1175, 1318],0.08, 0.26, 'sine',     0.14)
  };
})();

/* ------------------------------------------------------------
   2. SESSION SET — 8 words per Tonight's Reading run
   We need a word that exists in CARDS + GROUPS + DICT_QUESTIONS so
   all three stages can use the same 8 heads.
   ------------------------------------------------------------ */
const GROUP_MAP = new Map(GROUPS.map(g => [g.head, g.partner]));
const DICT_MAP  = new Map(DICT_QUESTIONS.map(d => [d.head, d]));
const ALL_HEADS = Object.keys(CARDS).filter(h =>
  GROUP_MAP.has(h) && DICT_MAP.has(h)
).sort();
const TOTAL_WORDS = Object.keys(CARDS).length;

function buildSession(startIdx) {
  const heads = ALL_HEADS.slice(startIdx, startIdx + 8);
  if (heads.length < 8) return null;
  return {
    words: heads,
    pairs: heads.slice(0, 4).map(h => ({ head: h, partner: GROUP_MAP.get(h) })),
    dict:  heads.map(h => DICT_MAP.get(h))
  };
}

/* ------------------------------------------------------------
   3. PERSISTED STATE
   ------------------------------------------------------------ */
const Store = {
  load() {
    try {
      return Object.assign(
        { progress: 0, learned: {}, mistakes: {} },
        JSON.parse(localStorage.getItem('hll-state') || '{}')
      );
    } catch { return { progress: 0, learned: {}, mistakes: {} }; }
  },
  save() { try { localStorage.setItem('hll-state', JSON.stringify(saved)); } catch {} }
};
const saved = Store.load();
function recordMistake(word) {
  saved.mistakes[word] = (saved.mistakes[word] || 0) + 1;
  Store.save();
}
function markLearned(word) {
  saved.learned[word] = true;
  Store.save();
}

/* ------------------------------------------------------------
   4. EPHEMERAL STATE — only lives for the current Tonight's Reading
   ------------------------------------------------------------ */
const state = {
  screen: 'cover',
  session: null,                     // buildSession()
  results: {},                       // results[word] = { match, oracle, dict }
  oracleQs: [],
  oracleIdx: 0,
  dictIdx: 0
};
function freshSession() {
  state.session = buildSession(saved.progress) || buildSession(0);
  state.results = {};
  state.session.words.forEach(w => state.results[w] = { match: null, oracle: null, dict: null });
}

/* ------------------------------------------------------------
   5. ROUTER  +  background-layer driver
   ------------------------------------------------------------ */
const BG_BY_SCREEN = {
  cover: 'bg-cover',
  stage1: 'bg-stage', stage2: 'bg-stage', stage3: 'bg-stage',
  'stage1-result': 'bg-result',
  'stage2-result': 'bg-result',
  'stage3-result': 'bg-result',
  note: 'bg-note', 'note-bucket': 'bg-note', index: 'bg-note', card: 'bg-note'
};
function go(screenId, opts = {}) {
  state.screen = screenId;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${screenId}`));
  window.scrollTo(0, 0);
  // swap the fixed background layer to match this screen's atmosphere.
  ['bg-cover','bg-stage','bg-result','bg-note'].forEach(c => document.body.classList.remove(c));
  document.body.classList.add(BG_BY_SCREEN[screenId] || 'bg-cover');
  if (Screens[screenId] && Screens[screenId].onEnter) Screens[screenId].onEnter(opts);
}

/* ------------------------------------------------------------
   6. BUTTON / LINK FACTORIES — one place per category
   ------------------------------------------------------------ */
function btn(label, onClick, { variant = '', disabled = false } = {}) {
  const b = document.createElement('button');
  b.className = 'btn' + (variant ? ' ' + variant : '');
  b.textContent = label;
  if (disabled) b.disabled = true;
  b.addEventListener('click', e => { if (!b.disabled) { SFX.tap(); onClick && onClick(e); } });
  return b;
}
function backToCover(label = '← close the book') {
  const b = document.createElement('button');
  b.className = 'back-to-cover';
  b.textContent = label;
  b.addEventListener('click', () => { SFX.tap(); LanBGM.stop(); go('cover'); });
  return b;
}
function lilGhost(label, onClick) {
  const b = document.createElement('button');
  b.className = 'lil-ghost';
  b.innerHTML = `<span>${escapeHtml(label)}</span>`;
  b.addEventListener('click', () => { SFX.tap(); onClick && onClick(); });
  return b;
}
// 🗝 key icon (gold-stroke SVG) — used to flank "Tonight's Reading" and
// "next chapter / next stage" buttons.  Always opens the next door.
function keyIconHtml() {
  return `<svg class="ico-key" viewBox="0 0 28 80" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="14" cy="14" r="7"/>
      <circle cx="14" cy="14" r="3" fill="currentColor" opacity=".55"/>
      <path d="M14 21 L14 64"/>
      <path d="M14 58 L20 58 M14 64 L18 64"/>
      <path d="M14 70 L14 74"/>
    </g>
  </svg>`;
}
function mainCTA(label, onClick) {
  const a = document.createElement('button');
  a.className = 'main-cta';
  // Keys come back as <img> tags this time — iOS Safari renders the
  // PNG alpha cleanly for img elements but tofu-tiled it when we
  // tried the same png via a ::before background.
  a.innerHTML = `
    <span class="cta-inner">
      <img class="cta-key cta-key-l" src="assets/icon-key.png?v=25" alt="">
      <span class="cta-text">${escapeHtml(label)}</span>
      <img class="cta-key cta-key-r" src="assets/icon-key.png?v=25" alt="">
    </span>
  `;
  a.addEventListener('click', () => {
    if (a.classList.contains('is-engaged')) return;
    LanBGM.unlock();
    a.classList.add('is-engaged');
    SFX.bling();
    setTimeout(() => onClick && onClick(), 700);
  });
  return a;
}
// "next stage / next chapter" — text-with-rules button (no keys, no pill).
// Passing { confirm: true } wraps the click in the "are you ready" modal,
// which is how every stage→stage transition should behave so the BGM swap
// has a clean handoff moment.
function nextDoor(label, onClick, { confirm = false } = {}) {
  const a = document.createElement('button');
  a.className = 'next-door';
  a.innerHTML = `<span class="nd-text">${escapeHtml(label)}</span>`;
  a.addEventListener('click', () => {
    if (a.classList.contains('is-engaged')) return;
    LanBGM.unlock();                  // safe to repeat-call
    a.classList.add('is-engaged');     // glow always — same beat as Tonight's Reading
    SFX.tap();
    if (confirm) {
      confirmReady(label, () => { onClick && onClick(); });
      // After the modal closes, allow another tap if the user picks "stay".
      setTimeout(() => a.classList.remove('is-engaged'), 900);
    } else {
      // ALWAYS un-engage after the action runs.  If onClick navigates
      // away the element is gone anyway; if onClick just popped a
      // validation modal (e.g. "colour every card first") the user
      // needs to be able to tap the button again afterwards.
      setTimeout(() => {
        onClick && onClick();
        a.classList.remove('is-engaged');
      }, 320);
    }
  });
  return a;
}
// Top-right "close the page" pill — the universal way home.  Visible on
// every screen except the cover itself.  On in-game screens we pop the
// leave-confirm modal first so the user doesn't kill their stage by accident.
function closeCorner({ confirm = false, to = 'cover', label = 'close the page' } = {}) {
  const b = document.createElement('button');
  b.className = 'close-corner corner-pin';
  b.setAttribute('aria-label', label);
  b.innerHTML = '<span class="cp-x"></span>';
  b.addEventListener('click', () => {
    SFX.tap();
    const exit = () => { LanBGM.stop(); go(to); };
    if (confirm) confirmLeave(exit);
    else exit();
  });
  return b;
}
// Top-left moon button — opens the side-drawer of "her words".
// The drawer is an OVERLAY (not navigation), so no leave-confirm
// is needed — picking a word from it is the user's explicit action.
function moonCorner() {
  const b = document.createElement('button');
  b.className = 'moon-corner corner-pin';
  b.setAttribute('aria-label', 'open her words');
  // Three-bar menu drawn in CSS via .mc-bar + two box-shadows — no
  // PNG, no unicode glyph that might tofu on iOS.
  b.innerHTML = '<span class="mc-bar"></span>';
  b.addEventListener('click', () => { SFX.tap(); openSidebar(); });
  return b;
}

/* ---------- SIDE DRAWER ("her words")  ----------
   Single global instance, lazy-built on first open.  Holds:
     - a counter of awakened / total words
     - a live-filter search input
     - the "still waking" list (everything not yet learned)
   Tapping any word closes the drawer and jumps to that word's card.   */
function _buildSidebar() {
  let drawer = document.getElementById('drawer');
  if (drawer) return drawer;
  drawer = document.createElement('aside');
  drawer.id = 'drawer';
  drawer.className = 'drawer';
  drawer.innerHTML = `
    <div class="drawer-veil"></div>
    <div class="drawer-panel">
      <div class="drawer-head">
        <div>
          <div class="drawer-title"><em>her words</em></div>
          <div class="drawer-count">…</div>
        </div>
        <button class="drawer-close" aria-label="close">×</button>
      </div>
      <div class="drawer-search-wrap">
        <input class="drawer-search" type="text" placeholder="search words…" autocomplete="off" spellcheck="false" autocapitalize="off">
      </div>
      <div class="drawer-list-label">…</div>
      <div class="drawer-list"></div>
    </div>
  `;
  document.body.appendChild(drawer);
  drawer.querySelector('.drawer-veil').addEventListener('click', closeSidebar);
  drawer.querySelector('.drawer-close').addEventListener('click', closeSidebar);
  drawer.querySelector('.drawer-search').addEventListener('input', refreshSidebarList);
  return drawer;
}
function openSidebar() {
  const drawer = _buildSidebar();
  refreshSidebarList();
  drawer.classList.add('open');
}
function closeSidebar() {
  const d = document.getElementById('drawer');
  if (d) d.classList.remove('open');
}
function refreshSidebarList() {
  const drawer = document.getElementById('drawer');
  if (!drawer) return;
  const all = Object.keys(CARDS).sort();
  const waking  = all.filter(w => !saved.learned[w]);
  const learned = all.filter(w =>  saved.learned[w]);
  const q = (drawer.querySelector('.drawer-search').value || '').toLowerCase().trim();
  drawer.querySelector('.drawer-count').textContent =
    `${learned.length} / ${all.length} awakened`;
  drawer.querySelector('.drawer-list-label').textContent =
    `still waking · ${waking.length}`;
  const list = drawer.querySelector('.drawer-list');
  list.innerHTML = '';
  waking
    .filter(w => !q || w.toLowerCase().includes(q))
    .forEach(w => {
      const a = document.createElement('button');
      a.className = 'drawer-word';
      a.textContent = w;
      a.addEventListener('click', () => {
        closeSidebar();
        SFX.pageTurn();
        go('card', { word: w, from: state.screen === 'card' ? (state._cardFrom || 'cover') : state.screen });
      });
      list.appendChild(a);
    });
}
// "Are you sure?" — close-the-book confirmation, shown when the user
// tries to exit a stage mid-way.  Closing forfeits the current page.
function confirmLeave(onLeave) {
  showModal({
    title: 'close the book for now?',
    body: `the page won't remember you tonight.`,
    actions: [
      { label: 'stay a little' },                                  // primary (close modal)
      { label: 'yes, leave the page', variant: 'ghost', onClick: onLeave }
    ]
  });
}

/* "are you ready" — the transition modal before each next-stage.
   Confirming triggers a deliberate moment: bling SFX + BGM swap is
   started by the caller's onReady, then we travel to the next page.
   "a little longer" simply closes the modal so the user can keep
   reviewing.                                                       */
function confirmReady(stageNameAwaits, onReady) {
  showModal({
    title:    `${stageNameAwaits} awaits`,
    body:     `have you learned what you need to?`,
    variant:  'ready',
    actions: [
      { label: `I'm ready ♡`, variant: 'primary', onClick: () => { SFX.bling(); onReady(); } },
      { label: 'a little longer', variant: 'ghost' }
    ]
  });
}

/* ------------------------------------------------------------
   7. SHARED PARTS — title strip, stage header, star sprinkles
   ------------------------------------------------------------ */
function titleStrip() {
  return `
    <div class="book-header">
      <h1 class="book-title">Her Little Lexicon</h1>
      <div class="book-subtitle"><span class="sp">words come softly, when she calls them</span></div>
    </div>
  `;
}
function stageHeader(chapterN, name) {
  // v=26: chapter title sits inside the long-frame PNG (6794E86E) so the
  // matching/reading/inscription pages all share the same purple-gold band.
  return `
    <div class="frame-chapter">
      <div class="frame-chapter-text">
        <span class="fc-num">chapter · ${chapterN}</span>
        <span class="fc-name">${escapeHtml(name)}</span>
      </div>
    </div>
  `;
}
function pageTitle(name) {
  // v=26: short page titles (note / index) sit inside the dome-shield PNG
  // (3C68C8E6) — the "顶头框".  One unified UI for every cover-side hub.
  return `
    <div class="frame-top">
      <div class="frame-top-text">${escapeHtml(name)}</div>
    </div>
  `;
}
// Visual writing-line at the bottom of the single-word parchment.
// NOT an input — pure cue that says "copy this word once".
function copyLine() {
  return `
    <div class="copy-line">
      <span class="cl-label">copy this word softly</span>
      <span class="cl-rule"></span>
      <span class="cl-mark">✦</span>
    </div>
  `;
}
// Tap-handler for collection-page tiles: nudge the tile (~8° wobble) +
// page-turn SFX, then navigate to the single-page parchment.
function flipToCard(tile, word, from) {
  if (tile.classList.contains('is-flipping')) return;
  tile.classList.add('is-flipping');
  SFX.pageTurn();
  setTimeout(() => go('card', { word, from }), 340);
}

// v=26.2 — index-style listing wrapped in the page panel (0511DE6F
// frame).  Used by both the full index and the note-bucket page so
// they share one visual.  Renders title (in the inner dome frame)
// + search input + A-Z bar + alpha-sectioned word rows.
function renderIndexLikePage(el, { title, words, backTo = 'cover', fromKey = 'index' }) {
  const groups = {};
  words.forEach(h => {
    const k = h[0].toUpperCase();
    (groups[k] = groups[k] || []).push(h);
  });
  const letters = Object.keys(groups).sort();
  el.innerHTML = `
    <div class="page-panel">
      <div class="panel-head">
        ${pageTitle(title)}
        <input class="index-search" type="text" placeholder="search words…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        <div class="alpha-bar">${letters.map(L => `<a data-letter="${L}">${L}</a>`).join('')}</div>
      </div>
      <div class="panel-body" id="panel-body-${fromKey}">
        ${words.length ? '' : `<div class="note-empty">no words yet · the page is still pristine</div>`}
      </div>
    </div>
  `;
  el.prepend(moonCorner());
  el.appendChild(closeCorner({ to: backTo }));

  $$('.alpha-bar a', el).forEach(a => {
    a.addEventListener('click', () => {
      const L = a.getAttribute('data-letter');
      const target = $(`#letter-${L}-${fromKey}`, el);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const body = $(`#panel-body-${fromKey}`, el);
  letters.forEach(L => {
    body.insertAdjacentHTML('beforeend',
      `<div class="alpha-section-title" id="letter-${L}-${fromKey}">${L}</div>`);
    groups[L].forEach(h => {
      const c = CARDS[h];
      const row = document.createElement('div');
      row.className = 'word-row';
      row.dataset.word = c.h.toLowerCase();
      row.dataset.zh = (c.zh || '').toLowerCase();
      row.innerHTML = `
        <span class="wr-word">${escapeHtml(c.h)}</span>
        <span class="wr-pos">${escapeHtml(c.pos || '')}</span>
        <span class="wr-zh">${escapeHtml(c.zh || '')}</span>
      `;
      row.addEventListener('click', () => flipToCard(row, h, fromKey));
      body.appendChild(row);
    });
  });

  $('.index-search', el).addEventListener('input', e => {
    const q = (e.target.value || '').toLowerCase().trim();
    $$('.word-row', el).forEach(row => {
      const hit = !q ||
        row.dataset.word.includes(q) ||
        row.dataset.zh.includes(q);
      row.style.display = hit ? '' : 'none';
    });
    $$('.alpha-section-title', el).forEach(h => {
      let n = h.nextElementSibling, alive = false;
      while (n && !n.classList.contains('alpha-section-title')) {
        if (n.style.display !== 'none') { alive = true; break; }
        n = n.nextElementSibling;
      }
      h.style.display = alive ? '' : 'none';
    });
  });
}

function sprinkleStars(container, count = 18) {
  if (!container || container.querySelector('.deco-stars')) return;
  const wrap = document.createElement('div');
  wrap.className = 'deco-stars';
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 's';
    // No text content — the sparkle is the PNG background.  Sizing the
    // box (not the font) is what actually makes the image visible.
    const sz = 8 + Math.floor(Math.random() * 12);    // 8–19 px
    s.style.top    = (Math.random() * 92) + '%';
    s.style.left   = (Math.random() * 96) + '%';
    s.style.width  = sz + 'px';
    s.style.height = sz + 'px';
    s.style.animationDelay = (Math.random() * 4) + 's';
    wrap.appendChild(s);
  }
  container.prepend(wrap);
}

/* ------------------------------------------------------------
   8. VOCAB CARD ("ex-card") renderer
   Shared by stage results, note, index detail view.
   classes here mirror the old aesthetic but are reusable.
   ------------------------------------------------------------ */
/* renderExCard — the study card, with the v21 progressive-reveal
   mechanic.  Initial view shows only what doesn't spoil the lesson:
   the headword, the family heads (with their pos+chinese), and the
   "her friend" / example sections as veiled placeholders.  Tapping
   a piece reveals it AND auto-plays its audio once — the forced
   learning beat.  The per-segment ♪ buttons replay without touching
   the reveal state.                                                   */
function renderExCard(headWord, mark = null, { rewrite = false, withControls = true } = {}) {
  const c = CARDS[headWord];
  if (!c) {
    const x = document.createElement('div');
    x.className = 'ex-card';
    x.textContent = headWord;
    return x;
  }
  const box = document.createElement('div');
  box.className = 'ex-card'
    + (mark === true ? ' is-correct' : mark === false ? ' is-wrong' : '');

  // The reveal queue — items unfold in order on each tap of the card.
  // Tap anywhere on .ex-card (except on a ♪ button / neighbour link /
  // close pill / input) → shift the first item out, drop its is-veiled
  // class, speak its audio.
  const queue = [];

  if (withControls) {
    box.insertAdjacentHTML('beforeend', `<button class="ex-card-close">close the page</button>`);
    box.querySelector('.ex-card-close').addEventListener('click', e => {
      e.stopPropagation();
      SFX.tap();
      const from = (state._cardFrom && state._cardFrom !== 'card') ? state._cardFrom : 'cover';
      go(from);
    });
  }

  /* HEAD — always visible.  Headword + chinese on one row. */
  const head = document.createElement('div');
  head.className = 'ex-head';
  head.innerHTML = `
    <button class="ex-speak ex-speak-head" data-sp="${escapeAttr(c.h)}" aria-label="play">♪</button>
    <span class="ex-headword">${escapeHtml(c.h)}</span>
    <span class="ex-pos">${escapeHtml((c.pos || '').slice(0, 3))}.</span>
    <span class="ex-headword-zh">${escapeHtml(c.zh || '')}</span>
  `;
  box.appendChild(head);

  /* HER FAMILY — heads always visible, each collocation is its own
     queued reveal.                                                   */
  if (c.family && c.family.length) {
    const fam = document.createElement('div');
    fam.className = 'ex-section ex-family';
    fam.innerHTML = `<div class="ex-label">her family</div>`;
    c.family.forEach(line => {
      const [w, pos, ex, ezh] = line.split('|').map(s => s.trim());
      const row = document.createElement('div');
      row.className = 'fam-row';
      row.innerHTML = `
        <div class="fam-head">
          <span class="fam-word">${escapeHtml(w)}</span>
          <span class="fam-pos">${escapeHtml(pos)}</span>
        </div>
        <div class="fam-reveal is-veiled">
          <button class="ex-speak" data-sp="${escapeAttr(ex || '')}" aria-label="play">♪</button>
          <span class="fam-ex">${escapeHtml(ex || '')}</span>
          <span class="fam-ex-zh">${escapeHtml(ezh || '')}</span>
        </div>
      `;
      fam.appendChild(row);
      if (ex) queue.push({ el: row.querySelector('.fam-reveal'), audio: ex });
    });
    box.appendChild(fam);
  }

  const div1 = document.createElement('div');
  div1.className = 'ex-divider';
  box.appendChild(div1);

  /* HER FRIEND — section label always visible, every collocation row
     is queued individually so each tap reveals + speaks ONE colloc.  */
  if (c.colloc && c.colloc.length) {
    const fr = document.createElement('div');
    fr.className = 'ex-section ex-friend';
    fr.innerHTML = `<div class="ex-label">her friend</div>`;
    c.colloc.forEach(line => {
      const [phrase, zh] = line.split('|').map(s => s.trim());
      const row = document.createElement('div');
      row.className = 'colloc-row is-veiled';
      row.innerHTML = `
        <button class="ex-speak" data-sp="${escapeAttr(phrase)}" aria-label="play">♪</button>
        <span class="colloc-en">${escapeHtml(phrase)}</span>
        <span class="colloc-zh">${escapeHtml(zh || '')}</span>
      `;
      fr.appendChild(row);
      queue.push({ el: row, audio: phrase });
    });
    box.appendChild(fr);
  }

  const div2 = document.createElement('div');
  div2.className = 'ex-divider';
  box.appendChild(div2);

  /* EXAMPLE — the full sentence sits at the end of the queue.        */
  if (c.example) {
    const ex = document.createElement('div');
    ex.className = 'ex-section ex-example is-veiled';
    ex.innerHTML = `
      <button class="ex-speak" data-sp="${escapeAttr(c.example)}" aria-label="play">♪</button>
      <div class="ex-example-text">
        <div class="ex-example-en">${escapeHtml(c.example)}</div>
        <div class="ex-example-zh">${escapeHtml(c.example_zh || '')}</div>
      </div>
    `;
    box.appendChild(ex);
    queue.push({ el: ex, audio: c.example });
  }

  /* HER NEIGHBOR — always visible. */
  if (c.partner) {
    const nb = document.createElement('div');
    nb.className = 'ex-section ex-neighbor';
    nb.innerHTML = `<span class="ex-label">her neighbor</span>
                    <button class="ex-neighbor-link">${escapeHtml(c.partner)}</button>`;
    nb.querySelector('.ex-neighbor-link').addEventListener('click', e => {
      e.stopPropagation();
      SFX.pageTurn();
      go('card', { word: c.partner, from: state.screen === 'card' ? (state._cardFrom || 'cover') : state.screen });
    });
    box.appendChild(nb);
  }

  if (rewrite) {
    const rw = document.createElement('div');
    rw.className = 'ex-rewrite';
    rw.innerHTML = `<div class="ex-rewrite-label">copy once</div>
                    <input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${escapeAttr(c.h)}">`;
    box.appendChild(rw);
  }

  /* The tap hint — visible while the queue still has items. */
  const tapHint = document.createElement('div');
  tapHint.className = 'ex-tap-hint';
  tapHint.textContent = '— tap to reveal more —';
  box.appendChild(tapHint);
  if (queue.length === 0) tapHint.style.display = 'none';

  if (withControls) {
    box.insertAdjacentHTML('beforeend', `<button class="ex-card-fold">fold this page</button>`);
    box.querySelector('.ex-card-fold').addEventListener('click', e => {
      e.stopPropagation();
      SFX.tap();
      // Re-veil every reveal target AND rebuild the queue from scratch.
      queue.length = 0;
      box.querySelectorAll('.fam-reveal').forEach((rv, i) => {
        rv.classList.add('is-veiled');
        const audio = rv.querySelector('.fam-ex')?.textContent || '';
        if (audio) queue.push({ el: rv, audio });
      });
      box.querySelectorAll('.colloc-row').forEach(row => {
        row.classList.add('is-veiled');
        const audio = row.querySelector('.colloc-en')?.textContent || '';
        queue.push({ el: row, audio });
      });
      const exNode = box.querySelector('.ex-example');
      if (exNode) {
        exNode.classList.add('is-veiled');
        const audio = exNode.querySelector('.ex-example-en')?.textContent || '';
        queue.push({ el: exNode, audio });
      }
      tapHint.textContent = '— tap to reveal more —';
      tapHint.style.display = '';
      tapHint.style.opacity = '';
    });
  }

  /* Per-segment ♪ play buttons replay one piece of audio without
     touching the reveal queue.  e.stopPropagation prevents the
     card-wide click from also firing on the same tap.                */
  box.querySelectorAll('.ex-speak').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const sp = b.getAttribute('data-sp');
      if (sp) speak(sp);
    });
  });

  /* THE CARD-WIDE LINEAR REVEAL — tap anywhere on .ex-card and the
     next item in the queue unfolds with its audio.                   */
  box.addEventListener('click', e => {
    if (e.target.closest('.ex-speak, .ex-neighbor-link, .ex-card-close, .ex-card-fold, .ex-rewrite, input, button')) return;
    if (queue.length === 0) return;
    const next = queue.shift();
    next.el.classList.remove('is-veiled');
    SFX.pageTurn();
    if (next.audio) speak(next.audio);
    if (queue.length === 0) {
      tapHint.textContent = '— page complete —';
      tapHint.style.opacity = '.45';
    }
  });

  return box;
}

/* ------------------------------------------------------------
   9. ORACLE QUESTION BUILDER — Chinese options
   ------------------------------------------------------------ */
function buildOracleQuestion(word) {
  const c = CARDS[word];
  const sentence = c.example || c.h;
  // Cloze: keep the first letter, blank the rest.  "abrupt" → "a______"
  const first  = c.h[0];
  const blanks = '_'.repeat(Math.max(5, c.h.length - 1));
  const blanked = `${first}${blanks}`;
  const sentenceHL = sentence.replace(
    new RegExp(`\\b${c.h}\\b`, 'i'),
    `<em class="q-blank">${blanked}</em>`
  );
  // 3 distractors that ALSO start with the same letter — the lesson
  // is "tell apart the words that share the first letter".
  const sameLetter = Object.keys(CARDS).filter(k =>
    k !== word && k[0].toLowerCase() === first.toLowerCase()
  );
  const wrongs = [];
  while (wrongs.length < 3 && sameLetter.length) {
    const cand = rand(sameLetter);
    if (!wrongs.includes(cand)) wrongs.push(cand);
  }
  // Fall back to random heads if there aren't 3 same-letter siblings.
  if (wrongs.length < 3) {
    const fallback = Object.keys(CARDS).filter(k => k !== word && !wrongs.includes(k));
    while (wrongs.length < 3 && fallback.length) {
      const cand = rand(fallback);
      if (!wrongs.includes(cand)) wrongs.push(cand);
    }
  }
  const options = shuffle([word, ...wrongs]);
  return { word, sentencePlain: sentence, sentenceHL, options, correctIdx: options.indexOf(word) };
}

/* ------------------------------------------------------------
   10. MODAL
   ------------------------------------------------------------ */
function showModal({ title, body = '', score = null, actions = [], variant = '' }) {
  const veil = $('#modal');
  const cls = 'modal-card' + (variant ? ` is-${variant}` : '');
  // Real sparkle PNGs live in the corners — iOS renders <img> alpha
  // natively, unlike CSS gradient pseudo-elements which kept tofu-ing
  // into white pluses.
  veil.innerHTML = `
    <div class="${cls}">
      <img class="m-spark m-spark-tl" src="assets/icon-spark-s.png?v=25" alt="">
      <img class="m-spark m-spark-tr" src="assets/icon-spark-s.png?v=25" alt="">
      <img class="m-spark m-spark-bl" src="assets/icon-spark-s.png?v=25" alt="">
      <img class="m-spark m-spark-br" src="assets/icon-spark-s.png?v=25" alt="">
      <div class="modal-title">${escapeHtml(title)}</div>
      ${body  ? `<div class="modal-body">${escapeHtml(body)}</div>` : ''}
      ${score ? `<div class="modal-score">${score.value}<small> / ${score.total}</small></div>` : ''}
      <div class="modal-actions"></div>
    </div>
  `;
  const ar = $('.modal-actions', veil);
  actions.forEach(a => {
    ar.appendChild(btn(a.label, () => { hideModal(); a.onClick && a.onClick(); }, { variant: a.variant || '' }));
  });
  SFX.pop();
  veil.classList.add('show');
}
function hideModal() { $('#modal').classList.remove('show'); }

/* ============================================================
   11. SCREENS
   ============================================================ */
const Screens = {

  /* ---------- COVER (the hub) ----------
     Plain reveal — content is visible immediately.  BGM unlocks on
     the FIRST real click on the page (the "Tonight's Reading" tap or
     either of the cover-side links), which is the Safari-safe spot
     to do it.  The moon-corner button isn't shown here because the
     cover IS the hub; the two cover-side links live in the layout.  */
  cover: {
    onEnter() {
      const el = $('#screen-cover');
      const learnedCount = Object.keys(saved.learned).length;
      el.innerHTML = '';

      const stage = document.createElement('div');
      stage.className = 'cover-stage';
      stage.innerHTML = `
        <div class="cover-mid">
          <div id="cover-cta-slot"></div>
          <div class="home-stats">${learnedCount} of ${TOTAL_WORDS} awakened</div>
        </div>
        <div class="cover-bottom">
          <div class="lil-row" id="cover-links"></div>
        </div>
      `;
      el.appendChild(stage);

      el.appendChild(moonCorner());

      // Tonight's Reading — unlocks audio on the way into stage 1.
      $('#cover-cta-slot', el).appendChild(mainCTA(`Tonight's Reading`, () => {
        LanBGM.unlock();
        const fade = document.createElement('div');
        fade.className = 'fade-out';
        document.body.appendChild(fade);
        requestAnimationFrame(() => fade.classList.add('show'));
        setTimeout(() => { LanBGM.stop(); }, 800);
        setTimeout(() => {
          freshSession();
          go('stage1');
          setTimeout(() => fade.remove(), 700);
          fade.classList.remove('show');
        }, 1000);
      }));
      $('#cover-links', el).appendChild(lilGhost('her note',  () => { LanBGM.unlock(); LanBGM.playHomeRandom({ volume: 0.42 }); go('note'); }));
      $('#cover-links', el).appendChild(lilGhost('the index', () => { LanBGM.unlock(); LanBGM.playHomeRandom({ volume: 0.42 }); go('index'); }));
    }
  },

  /* ---------- STAGE 1 — the matching ----------
     Layout is 4 rows × 2 columns.  The left column holds the four
     heads (in random order within the column) and the right column
     holds the four partners (also shuffled within their column).
     A "pair" can only be ONE left + ONE right of the same tag.
     If the user dyes a left card while the current tag already has
     a left card, the previous left is cleared — same with right.
     This rule is what the user asked for: 左+右 only.            */
  stage1: {
    onEnter() {
      LanBGM.playGameRandom({ volume: 0.40 });
      const el = $('#screen-stage1');
      const s = state.session;
      const pairs = s.pairs;
      // Build two shuffled columns, then interleave into row-major order:
      // shuffled[0] = row0-LEFT, [1] = row0-RIGHT, [2] = row1-LEFT, ...
      const leftCol  = shuffle(pairs.map((p, i) => ({ text: p.head,    pairId: i, side: 'L' })));
      const rightCol = shuffle(pairs.map((p, i) => ({ text: p.partner, pairId: i, side: 'R' })));
      const shuffled = [];
      for (let r = 0; r < pairs.length; r++) {
        shuffled.push(leftCol[r]);
        shuffled.push(rightCol[r]);
      }
      const tagOf = new Array(shuffled.length).fill(null);
      let currentTag = 0;

      el.innerHTML = `
        ${stageHeader(1, 'the matching')}
        <div class="q-progress">tap one on the left, one on the right · four pairs</div>
        <div class="match-grid"></div>
        <div class="match-actions"></div>
      `;

      el.prepend(moonCorner()); el.appendChild(closeCorner({ confirm: true }));

      const grid = $('.match-grid', el);
      shuffled.forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = 'card card--match' + (c.side === 'L' ? ' is-left' : ' is-right');
        card.textContent = c.text;
        card.addEventListener('click', () => paint(idx));
        grid.appendChild(card);
      });

      const actions = $('.match-actions', el);
      actions.appendChild(nextDoor('confirm', () => submit()));

      function repaint() {
        $$('.card--match', grid).forEach((node, i) => {
          for (let k = 0; k < 4; k++) node.classList.remove('tag-' + k);
          if (tagOf[i] !== null) node.classList.add('tag-' + tagOf[i]);
        });
      }

      function paint(idx) {
        const side = shuffled[idx].side;

        // tapping an already-tagged card clears it
        if (tagOf[idx] !== null) {
          tagOf[idx] = null;
          repaint();
          SFX.tap();
          return;
        }

        // the current pair already has a card on this same side?
        // clear it — only one left + one right may share a colour.
        const sameSideIdx = tagOf.findIndex((t, i) => t === currentTag && shuffled[i].side === side);
        if (sameSideIdx >= 0) tagOf[sameSideIdx] = null;

        // tag this card and bump the current colour when the pair is full
        tagOf[idx] = currentTag;
        if (tagOf.filter(t => t === currentTag).length >= 2) {
          // pick the next colour that still has room
          for (let inc = 1; inc <= 4; inc++) {
            const cand = (currentTag + inc) % 4;
            if (tagOf.filter(t => t === cand).length < 2) { currentTag = cand; break; }
          }
        }
        repaint();
        SFX.tap();
      }

      function submit() {
        if (tagOf.some(t => t === null)) {
          showModal({ title: 'colour every card first', actions: [{ label: 'okay' }] });
          return;
        }
        let correct = 0;
        const cardResult = new Array(shuffled.length).fill(false);
        for (let t = 0; t < 4; t++) {
          const idxs = tagOf.map((v, i) => v === t ? i : -1).filter(i => i >= 0);
          if (idxs.length !== 2) continue;
          const [a, b] = idxs;
          if (shuffled[a].pairId === shuffled[b].pairId) {
            correct++;
            cardResult[a] = true; cardResult[b] = true;
          }
        }
        // Persist the L-side outcome for the chapter summary / mistakes.
        shuffled.forEach((c, i) => {
          if (c.side !== 'L') return;
          if (cardResult[i]) state.results[c.text].match = true;
          else { state.results[c.text].match = false; recordMistake(c.text); }
        });
        // Persist the full 8-tile result for the dedicated result page —
        // we want to replay each card in the same colour the user dyed
        // it, with a ✓ / ✗ on whether its pair was correct.
        state.session.matchResult = shuffled.map((c, i) => ({
          text: c.text, pairId: c.pairId, tag: tagOf[i], correct: cardResult[i]
        }));
        showModal({
          title: 'pages flipped',
          score: { value: correct, total: 4 },
          actions: [{ label: 'see results', onClick: () => go('stage1-result') }]
        });
      }
    }
  },

  /* ---------- STAGE 1 RESULT ----------
     What it is NOT: a stack of full study cards.
     What it IS: an echo of the matching board the user just finished.
     Each of the 8 tiles keeps the colour the user painted it (tag-0
     ..tag-3), gets a ✓ if its pair turned out right or ✗ if not, and
     becomes a doorway to that word's study card on tap.               */
  'stage1-result': {
    onEnter() {
      LanBGM.playResultRandom({ volume: 0.42 });
      const el = $('#screen-stage1-result');
      const result = state.session.matchResult || [];
      const correctPairs = new Set(result.filter(r => r.correct).map(r => r.pairId)).size;

      el.innerHTML = `
        ${stageHeader(1, 'the matching')}
        <div class="score-block">
          <div class="score-label">your hand</div>
          <div class="score-value">${correctPairs}<small> / 4</small></div>
        </div>
        <div class="stage-actions"></div>
        <div class="match-result-grid"></div>
        <div class="match-result-hint">— touch any word to read its page —</div>
      `;

      el.prepend(moonCorner());
      el.appendChild(closeCorner());

      // Next-stage button sits right below the score so it's a single
      // glance from "how did I do?" to "let me move on".
      $('.stage-actions', el).appendChild(nextDoor('the reading', () => go('stage2'), { confirm: true }));

      const grid = $('.match-result-grid', el);
      result.forEach(r => {
        const tile = document.createElement('button');
        tile.className = `card card--match tag-${r.tag} ${r.correct ? 'is-correct' : 'is-wrong'}`;
        tile.innerHTML = `
          <span class="tile-mark">${r.correct ? '✓' : '✗'}</span>
          <span class="tile-text">${escapeHtml(r.text)}</span>
        `;
        tile.addEventListener('click', () => flipToCard(tile, r.text, 'stage1-result'));
        grid.appendChild(tile);
      });
    }
  },

  /* ---------- STAGE 2 — the reading ---------- */
  stage2: {
    onEnter() {
      LanBGM.playHomeRandom({ volume: 0.38 });
      const el = $('#screen-stage2');
      state.oracleQs  = state.session.words.map(w => buildOracleQuestion(w));
      state.oracleIdx = 0;
      el.innerHTML = `
        ${stageHeader(2, 'the reading')}
        <div class="oracle-stage" id="oracle-stage"></div>
      `;

      el.prepend(moonCorner()); el.appendChild(closeCorner({ confirm: true }));
      drawQ();

      function drawQ() {
        const stage = $('#oracle-stage', el);
        const q = state.oracleQs[state.oracleIdx];
        stage.innerHTML = `
          <div class="q-progress">${String(state.oracleIdx + 1).padStart(2, '0')} · 08</div>
          <div class="q-sentence">${q.sentenceHL}</div>
          <div class="oracle-options"></div>
        `;
        const opts = $('.oracle-options', stage);
        q.options.forEach((opt, oi) => {
          const b = document.createElement('button');
          b.className = 'card card--option';
          b.textContent = opt;
          b.addEventListener('click', () => pick(oi, b));
          opts.appendChild(b);
        });
      }

      function pick(oi, button) {
        const q = state.oracleQs[state.oracleIdx];
        const all = $$('.card--option');
        all.forEach(b => b.disabled = true);

        // tiny "thinking" beat — the deep-pink inner glow on the chosen
        // option before the verdict.  Without this beat the click feels
        // too brusque.
        button.classList.add('is-picking');

        setTimeout(() => {
          button.classList.remove('is-picking');
          if (oi === q.correctIdx) {
            button.classList.add('picked-right');
            state.results[q.word].oracle = true;
            SFX.right();
          } else {
            button.classList.add('picked-wrong');
            all[q.correctIdx].classList.add('reveal-right');
            state.results[q.word].oracle = false;
            recordMistake(q.word);
            SFX.wrong();
          }
          // Speak the full example sentence so the user hears the word
          // in context.  Then arm a one-shot tap-anywhere listener: the
          // user controls when to move on.
          speak(q.sentencePlain);
          armAdvance();
        }, 280);

        function armAdvance() {
          // a hint that the page is waiting for them
          let hint = $('.q-tap-hint', stage);
          if (!hint) {
            hint = document.createElement('div');
            hint.className = 'q-tap-hint';
            hint.textContent = '— tap anywhere to turn the page —';
            stage.appendChild(hint);
          }
          const advance = (ev) => {
            // ignore taps on the moon / close pills
            if (ev && ev.target && ev.target.closest('.moon-corner, .close-corner')) return;
            document.removeEventListener('click', advance, true);
            state.oracleIdx++;
            if (state.oracleIdx >= state.oracleQs.length) go('stage2-result');
            else drawQ();
          };
          // brief delay so the same click that picked doesn't immediately advance
          setTimeout(() => document.addEventListener('click', advance, true), 480);
        }
      }
    }
  },

  /* ---------- STAGE 2 RESULT ---------- */
  'stage2-result': {
    onEnter() {
      LanBGM.playResultRandom({ volume: 0.42 });
      const el = $('#screen-stage2-result');
      const right = state.session.words.filter(w => state.results[w].oracle).length;
      el.innerHTML = `
        ${stageHeader(2, 'the reading')}
        <div class="score-block">
          <div class="score-label">her reading</div>
          <div class="score-value">${right}<small> / 8</small></div>
        </div>
        <div class="stage-actions"></div>
        <div class="result-grid"></div>
      `;

      el.prepend(moonCorner());
      el.appendChild(closeCorner());
      $('.stage-actions', el).appendChild(nextDoor('the writing hand', () => go('stage3'), { confirm: true }));
      const grid = $('.result-grid', el);
      state.session.words.forEach(w => grid.appendChild(renderExCard(w, state.results[w].oracle, { rewrite: true, withControls: false })));
    }
  },

  /* ---------- STAGE 3 — the inscription ---------- */
  stage3: {
    onEnter() {
      LanBGM.playGameRandom({ volume: 0.40 });
      const el = $('#screen-stage3');
      state.dictIdx = 0;
      el.innerHTML = `
        ${stageHeader(3, 'the inscription')}
        <div class="dict-stage" id="dict-stage"></div>
      `;

      el.prepend(moonCorner()); el.appendChild(closeCorner({ confirm: true }));
      drawQ();

      function drawQ() {
        const stage = $('#dict-stage', el);
        const q = state.session.dict[state.dictIdx];
        // "(p)_______ goods" — keep the answer's first letter visible inside
        // parens, blank the rest, leave the surrounding phrase intact.
        const first = q.answer[0];
        const rest  = '_'.repeat(Math.max(5, q.answer.length - 1));
        const masked = q.prompt.replace(new RegExp(q.answer, 'i'), `(${first})${rest}`);
        stage.innerHTML = `
          <div class="q-progress">${String(state.dictIdx + 1).padStart(2, '0')} · 08</div>
          <div class="dict-prompt">${escapeHtml(masked)}</div>
          <div class="dict-prompt-zh">${escapeHtml(q.prompt_zh)}</div>
          <div class="dict-input-row">
            <input class="dict-input" id="dict-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${escapeAttr(q.hint)}…">
            <img class="dict-quill" src="assets/icon-quill.png?v=25" alt="">
          </div>
          <div class="dict-feedback" id="dict-feedback"></div>
          <div class="dict-actions" id="dict-actions"></div>
        `;
        const input = $('#dict-input', stage);
        const actions = $('#dict-actions', stage);
        actions.appendChild(btn('write', () => check()));
        input.focus();
        input.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
      }

      function advance() {
        state.dictIdx++;
        if (state.dictIdx >= state.session.dict.length) go('stage3-result');
        else $('#dict-stage').querySelector ? drawQ() : drawQ();
      }

      function check() {
        const stage = $('#dict-stage', el);
        const q = state.session.dict[state.dictIdx];
        const input = $('#dict-input', stage);
        const feedback = $('#dict-feedback', stage);
        const guess = (input.value || '').trim().toLowerCase();
        if (!guess) return;
        if (guess === q.answer.toLowerCase()) {
          state.results[q.head].dict = true;
          input.disabled = true;
          feedback.textContent = q.prompt;
          feedback.className = 'dict-feedback is-correct';
          $('#dict-actions', stage).innerHTML = '';
          SFX.right();
          speak(q.prompt).then(() => setTimeout(advance, 700));
        } else {
          state.results[q.head].dict = false;
          recordMistake(q.head);
          // wipe the wrong attempt, keep the SAME input field, ask for a
          // re-inscription.  on correct match we auto-advance.
          input.value = '';
          input.classList.add('is-wrong');
          feedback.innerHTML = `correct · <em>${escapeHtml(q.answer)}</em> · write it once more`;
          feedback.className = 'dict-feedback is-wrong';
          $('#dict-actions', stage).innerHTML = '';
          SFX.wrong();
          const rew = input;
          rew.focus();
          rew.addEventListener('input', () => {
            if (rew.value.trim().toLowerCase() === q.answer.toLowerCase()) {
              rew.disabled = true;
              feedback.textContent = q.prompt;
              feedback.className = 'dict-feedback is-correct';
              SFX.right();
              speak(q.prompt).then(() => setTimeout(advance, 700));
            }
          });
        }
      }
    }
  },

  /* ---------- STAGE 3 RESULT  +  SUMMARY (end of session) ---------- */
  'stage3-result': {
    onEnter() {
      LanBGM.playResultRandom({ volume: 0.42 });
      SFX.finish();
      // bump progress + mark learned
      state.session.words.forEach(w => { markLearned(w); });
      saved.progress = Math.min(saved.progress + 8, ALL_HEADS.length);
      Store.save();

      const el = $('#screen-stage3-result');
      const right = state.session.words.filter(w => state.results[w].dict).length;
      const totalCorrect = state.session.words.reduce((acc, w) => {
        const r = state.results[w];
        return acc + (r.match ? 1 : 0) + (r.oracle ? 1 : 0) + (r.dict ? 1 : 0);
      }, 0);
      el.innerHTML = `
        ${stageHeader(3, 'the inscription')}
        <div class="score-block">
          <div class="score-label">tonight's chapter</div>
          <div class="score-value">${totalCorrect}<small> / 24</small></div>
        </div>
        <div class="stage-actions"></div>
        <div class="summary-list" id="summary"></div>
        <div class="result-grid"></div>
      `;

      el.prepend(moonCorner());
      el.appendChild(closeCorner());

      $('.stage-actions', el).appendChild(nextDoor('the next chapter', () => { LanBGM.stop(); go('cover'); }, { confirm: true }));

      const tickHtml = v =>
        v === null ? `<div class="tick">—</div>`
                   : `<div class="tick ${v ? 'ok' : 'bad'}">${v ? '✓' : '✗'}</div>`;
      const sum = $('#summary', el);
      state.session.words.forEach(w => {
        const r = state.results[w];
        const row = document.createElement('div');
        row.className = 'summary-row';
        row.innerHTML = `<div class="sum-word">${escapeHtml(w)}</div>${tickHtml(r.match)}${tickHtml(r.oracle)}${tickHtml(r.dict)}`;
        sum.appendChild(row);
      });
      const grid = $('.result-grid', el);
      state.session.words.forEach(w => grid.appendChild(renderExCard(w, state.results[w].dict, { withControls: false })));
    }
  },

  /* ---------- NOTE hub (cover-side, NOT in game flow) ----------
     v=26.2 — page panel (0511DE6F frame) wraps the inner dome title
     + 2 horizontal bucket buttons.  Clicking a bucket lands on
     screen-note-bucket which now reuses the index list format.    */
  note: {
    onEnter() {
      const el = $('#screen-note');
      const m = saved.mistakes;
      const entries = Object.entries(m);
      const soft  = entries.filter(([_, c]) => c >= 1 && c <= 2).map(([w]) => w);
      const haunt = entries.filter(([_, c]) => c >= 3).map(([w]) => w);
      el.innerHTML = `
        <div class="page-panel page-panel--short">
          ${pageTitle('her little note')}
          <div class="bucket-row">
            <button class="bucket-card" data-bucket="soft" ${soft.length  ? '' : 'disabled'}>
              <div class="bk-hint">words that slipped once</div>
              <div class="bk-value">${soft.length}</div>
              <div class="bk-label">soft slips</div>
            </button>
            <button class="bucket-card" data-bucket="haunt" ${haunt.length ? '' : 'disabled'}>
              <div class="bk-hint">words that return</div>
              <div class="bk-value">${haunt.length}</div>
              <div class="bk-label">haunting words</div>
            </button>
          </div>
          ${entries.length ? '' : `<div class="note-empty">no slips yet · the page is still pristine</div>`}
        </div>
      `;
      el.prepend(moonCorner());
      el.appendChild(closeCorner());

      $$('.bucket-card', el).forEach(b => b.addEventListener('click', () => {
        if (b.disabled) return;
        SFX.tap();
        go('note-bucket', { bucket: b.dataset.bucket });
      }));
    }
  },

  /* ---------- NOTE BUCKET — index-style filtered list -----------
     v=26.2 — user simplification: bucket page now reuses the same
     panel/search/A-Z/list UI as the index, just with the bucket's
     filtered word set.  One layout instead of a separate grid. */
  'note-bucket': {
    onEnter({ bucket } = {}) {
      const m = saved.mistakes;
      const words = Object.entries(m)
        .filter(([_, c]) => bucket === 'haunt' ? c >= 3 : (c >= 1 && c <= 2))
        .map(([w]) => w)
        .filter(w => CARDS[w])
        .sort();
      const title = bucket === 'haunt' ? 'haunting words' : 'soft slips';
      renderIndexLikePage($('#screen-note-bucket'),
        { title, words, backTo: 'note', fromKey: 'note-bucket' });
    }
  },

  /* ---------- INDEX (cover-side, A-Z) ----------
     v=26.2 — same panel UI as note-bucket via renderIndexLikePage. */
  index: {
    onEnter() {
      const heads = Object.keys(CARDS).sort();
      renderIndexLikePage($('#screen-index'),
        { title: 'the index', words: heads, backTo: 'cover', fromKey: 'index' });
    }
  },

  /* ---------- CARD detail — the single-page parchment ----------
     v=26 — full-screen study page, .ex-card gets the .is-parchment
     skin (cream E993B660 scroll background, dark-sepia text) plus
     a copy-line at the bottom.  Reveal mechanic (tap-to-show next
     audio phrase) stays exactly as before. */
  card: {
    onEnter(opts) {
      const el = $('#screen-card');
      const word = opts.word;
      const from = opts.from || 'cover';
      state._cardFrom = from;
      el.innerHTML = `<div class="card-host"></div>`;
      el.prepend(moonCorner());
      el.appendChild(closeCorner({ to: from }));
      const card = renderExCard(word, null, { withControls: true });
      card.classList.add('is-parchment', 'is-entering');
      card.insertAdjacentHTML('beforeend', copyLine());
      $('.card-host', el).appendChild(card);
      // strip the entrance class once the fade+scale animation finishes
      setTimeout(() => card.classList.remove('is-entering'), 620);
    }
  }
};

/* ============================================================
   12. BOOTSTRAP
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  go('cover');
});
