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
    bling:   () => tone([1047, 1319, 1568, 1760, 2093], 0.07, 0.32, 'triangle', 0.14),
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
  note: 'bg-note', index: 'bg-note', card: 'bg-note'
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
  b.innerHTML = `<span class="lil-fleur">❦</span><span>${escapeHtml(label)}</span><span class="lil-fleur">❦</span>`;
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
  a.innerHTML = `
    <span class="cta-key cta-key-l">${keyIconHtml()}</span>
    <span class="cta-text">${escapeHtml(label)}</span>
    <span class="cta-key cta-key-r">${keyIconHtml()}</span>
    <span class="cta-rule"></span>
  `;
  a.addEventListener('click', () => {
    if (a.classList.contains('is-engaged')) return;
    a.classList.add('is-engaged');
    SFX.bling();
    setTimeout(() => onClick && onClick(), 700);
  });
  return a;
}
// "next stage / next chapter" — pink pill with two keys flanking the label.
function nextDoor(label, onClick) {
  const a = document.createElement('button');
  a.className = 'next-door';
  a.innerHTML = `
    <span class="nd-key">${keyIconHtml()}</span>
    <span class="nd-text">${escapeHtml(label)}</span>
    <span class="nd-key">${keyIconHtml()}</span>
  `;
  a.addEventListener('click', () => {
    if (a.classList.contains('is-engaged')) return;
    a.classList.add('is-engaged');
    SFX.bling();
    setTimeout(() => onClick && onClick(), 600);
  });
  return a;
}
// Top-right "close the page" pill — the universal way home.  Visible on
// every screen except the cover itself.  On in-game screens we pop the
// leave-confirm modal first so the user doesn't kill their stage by accident.
function closeCorner({ confirm = false, to = 'cover', label = 'close the page' } = {}) {
  const b = document.createElement('button');
  b.className = 'close-corner';
  b.textContent = label;
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
  b.className = 'moon-corner';
  b.title = 'her words';
  b.setAttribute('aria-label', 'open her words');
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
        go('card', { word: w, from: state.screen });
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
      { label: 'stay a little' },                            // pink (default)
      { label: 'close it', variant: 'ghost', onClick: onLeave }
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
      <div class="book-subtitle">✦<span class="sp">words come softly, when she calls them</span>✦</div>
    </div>
  `;
}
function stageHeader(chapterN, name) {
  return `
    <div class="stage-head">
      <div class="stage-chapter">chapter · ${chapterN}</div>
      <div class="stage-name"><span class="nm-fleur">❦</span>${escapeHtml(name)}<span class="nm-fleur">❦</span></div>
      <div class="stage-rule"></div>
    </div>
  `;
}
function pageTitle(name) {
  return `<div class="page-title"><span class="pt-fleur">❦</span>${escapeHtml(name)}<span class="pt-fleur">❦</span></div>`;
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
function renderExCard(headWord, mark = null, { rewrite = false, expanded = false } = {}) {
  const c = CARDS[headWord];
  if (!c) {
    const x = document.createElement('div');
    x.className = 'ex-card';
    x.textContent = headWord;
    return x;
  }
  const box = document.createElement('div');
  box.className = 'ex-card'
    + (mark === true ? ' is-correct' : mark === false ? ' is-wrong' : '')
    + (expanded ? '' : ' is-collapsed');

  /* The HEAD strip — always visible.  This is the "compact card" face. */
  const head = document.createElement('div');
  head.className = 'ex-head';
  head.innerHTML = `
    <button class="ex-speak ex-speak-head" data-sp="${escapeAttr(c.h)}" aria-label="play">♪</button>
    <span class="ex-hw-fleur">❧</span>
    <span class="ex-headword">${escapeHtml(c.h)}</span>
    <span class="ex-hw-fleur">❧</span>
    <span class="ex-pos">${escapeHtml(c.pos || '')}</span>
    <span class="ex-headword-zh">${escapeHtml(c.zh || '')}</span>
  `;
  box.appendChild(head);

  /* The BODY — hidden until the user taps to wake the card. */
  const body = document.createElement('div');
  body.className = 'ex-body';

  /* family */
  if (c.family && c.family.length) {
    const fam = document.createElement('div');
    fam.className = 'ex-section ex-family';
    fam.innerHTML = `<div class="ex-label">her family</div>` + c.family.map(line => {
      const [w, pos, ex, ezh] = line.split('|').map(s => s.trim());
      return `<div class="fam-row">
        <span class="fam-word">${escapeHtml(w)}</span>
        <span class="fam-pos">${escapeHtml(pos)}</span>
        <button class="ex-speak" data-sp="${escapeAttr(ex)}" aria-label="play">♪</button>
        <span class="fam-ex">${escapeHtml(ex)}</span>
        <span class="fam-ex-zh">${escapeHtml(ezh || '')}</span>
      </div>`;
    }).join('');
    body.appendChild(fam);
  }

  /* collocations (her friend) */
  if (c.colloc && c.colloc.length) {
    const fr = document.createElement('div');
    fr.className = 'ex-section ex-friend';
    fr.innerHTML = `<div class="ex-label">her friend</div>` + c.colloc.map(line => {
      const [phrase, zh] = line.split('|').map(s => s.trim());
      return `<div class="colloc-row">
        <button class="ex-speak" data-sp="${escapeAttr(phrase)}" aria-label="play">♪</button>
        <span class="colloc-en">${escapeHtml(phrase)}</span>
        <span class="colloc-zh">${escapeHtml(zh || '')}</span>
      </div>`;
    }).join('');
    body.appendChild(fr);
  }

  /* example */
  if (c.example) {
    const ex = document.createElement('div');
    ex.className = 'ex-example';
    ex.innerHTML = `
      <button class="ex-speak" data-sp="${escapeAttr(c.example)}" aria-label="play">♪</button>
      <div class="ex-example-text">
        <div class="ex-example-en">${escapeHtml(c.example)}</div>
        <div class="ex-example-zh">${escapeHtml(c.example_zh || '')}</div>
      </div>`;
    body.appendChild(ex);
  }

  /* her neighbor — the synonym partner.  Clicking it jumps to that
     word's card without losing the current stage state.            */
  if (c.partner) {
    const nb = document.createElement('div');
    nb.className = 'ex-section ex-neighbor';
    nb.innerHTML = `<span class="ex-label">her neighbor</span>
                    <button class="ex-neighbor-link">${escapeHtml(c.partner)}</button>`;
    nb.querySelector('.ex-neighbor-link').addEventListener('click', e => {
      e.stopPropagation();
      SFX.pageTurn();
      go('card', { word: c.partner, from: state.screen });
    });
    body.appendChild(nb);
  }

  /* optional rewrite input — used by stage-2 result for handwriting. */
  if (rewrite) {
    const rw = document.createElement('div');
    rw.className = 'ex-rewrite';
    rw.innerHTML = `<div class="ex-rewrite-label">copy once</div>
                    <input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${escapeAttr(c.h)}">`;
    body.appendChild(rw);
  }

  box.appendChild(body);

  /* every ♪ play button speaks its own segment, never bubbling up to
     trigger a card-wide reveal. */
  box.querySelectorAll('.ex-speak').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      speak(b.getAttribute('data-sp'));
    });
  });

  /* TAP TO WAKE — the "forced learning" beat.  When the card is
     collapsed, any tap on the head expands the body AND auto-plays
     the example sentence once.  After that the card stays open and
     the per-segment ♪ buttons handle further audio.                  */
  head.addEventListener('click', e => {
    if (e.target.closest('.ex-speak')) return;
    if (!box.classList.contains('is-collapsed')) return;
    box.classList.remove('is-collapsed');
    SFX.pageTurn();
    speak(c.example || c.h);
  });

  return box;
}

/* ------------------------------------------------------------
   9. ORACLE QUESTION BUILDER — Chinese options
   ------------------------------------------------------------ */
function buildOracleQuestion(word) {
  const c = CARDS[word];
  const sentence = c.example || c.h;
  const sentenceHL = sentence.replace(new RegExp(`\\b(${c.h})\\b`, 'i'), '<em>$1</em>');
  const pool = Object.keys(CARDS).filter(k => k !== word);
  const wrongs = [];
  while (wrongs.length < 3) {
    const cand = CARDS[rand(pool)].zh;
    if (cand && cand !== c.zh && !wrongs.includes(cand)) wrongs.push(cand);
  }
  const options = shuffle([c.zh, ...wrongs]);
  return { word, sentencePlain: sentence, sentenceHL, options, correctIdx: options.indexOf(c.zh) };
}

/* ------------------------------------------------------------
   10. MODAL
   ------------------------------------------------------------ */
function showModal({ title, body = '', score = null, actions = [] }) {
  const veil = $('#modal');
  veil.innerHTML = `
    <div class="modal-card">
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
      sprinkleStars(el, 18);
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

  /* ---------- STAGE 1 — the matching ---------- */
  stage1: {
    onEnter() {
      LanBGM.playGameRandom({ volume: 0.40 });
      const el = $('#screen-stage1');
      const s = state.session;
      const pairs = s.pairs;
      const cards = [];
      pairs.forEach((p, i) => {
        cards.push({ text: p.head,    pairId: i, side: 'L' });
        cards.push({ text: p.partner, pairId: i, side: 'R' });
      });
      const shuffled = shuffle(cards);
      const tagOf = new Array(shuffled.length).fill(null);
      let currentTag = 0;

      el.innerHTML = `
        ${stageHeader(1, 'the matching')}
        <div class="q-progress">tap two cards to dye them the same colour · four pairs</div>
        <div class="match-grid"></div>
        <div class="match-actions"></div>
      `;
      sprinkleStars(el, 12);
      el.prepend(moonCorner()); el.appendChild(closeCorner({ confirm: true }));

      const grid = $('.match-grid', el);
      shuffled.forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = 'match-card';
        card.textContent = c.text;
        card.addEventListener('click', () => paint(idx, card));
        grid.appendChild(card);
      });

      const actions = $('.match-actions', el);
      actions.appendChild(btn('confirm', () => submit(), { variant: 'pink' }));

      function paint(idx) {
        if (tagOf[idx] !== null) {
          tagOf[idx] = null;
        } else {
          const sameCount = tagOf.filter(t => t === currentTag).length;
          if (sameCount >= 2) currentTag = (currentTag + 1) % 4;
          tagOf[idx] = currentTag;
        }
        // recolor every card from tagOf
        $$('.match-card', grid).forEach((node, i) => {
          for (let k = 0; k < 4; k++) node.classList.remove('tag-' + k);
          if (tagOf[i] !== null) node.classList.add('tag-' + tagOf[i]);
        });
        SFX.tap();
        // bump if current colour just got full
        if (tagOf.filter(t => t === currentTag).length >= 2) {
          currentTag = (currentTag + 1) % 4;
        }
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
        shuffled.forEach((c, i) => {
          if (c.side !== 'L') return;
          if (cardResult[i]) state.results[c.text].match = true;
          else { state.results[c.text].match = false; recordMistake(c.text); }
        });
        showModal({
          title: 'pages flipped',
          score: { value: correct, total: 4 },
          actions: [{ label: 'see results', onClick: () => go('stage1-result') }]
        });
      }
    }
  },

  /* ---------- STAGE 1 RESULT ---------- */
  'stage1-result': {
    onEnter() {
      LanBGM.playResultRandom({ volume: 0.42 });
      const el = $('#screen-stage1-result');
      const tested = state.session.words.slice(0, 4);
      const right = tested.filter(w => state.results[w].match).length;
      el.innerHTML = `
        ${stageHeader(1, 'the matching')}
        <div class="score-header">
          <div class="label">your hand</div>
          <div class="value">${right}<small> / 4</small></div>
        </div>
        <div class="result-grid"></div>
        <div class="stage-actions"></div>
      `;
      sprinkleStars(el, 10);
      el.prepend(moonCorner()); el.appendChild(closeCorner());
      const grid = $('.result-grid', el);
      tested.forEach(w => grid.appendChild(renderExCard(w, state.results[w].match)));
      const actions = $('.stage-actions', el);
      actions.appendChild(nextDoor('the reading', () => go('stage2')));
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
      sprinkleStars(el, 10);
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
          b.className = 'oracle-option';
          b.textContent = opt;
          b.addEventListener('click', () => pick(oi, b));
          opts.appendChild(b);
        });
      }

      function pick(oi, button) {
        const q = state.oracleQs[state.oracleIdx];
        const all = $$('.oracle-option');
        all.forEach(b => b.disabled = true);

        // tiny "thinking" beat — the deep-pink inner glow on the chosen option
        // before the verdict.  Without this beat the click feels too brusque.
        button.classList.add('is-picking');

        setTimeout(() => {
          button.classList.remove('is-picking');
          if (oi === q.correctIdx) {
            button.classList.add('picked-right');     // rose / 肉色 glow
            state.results[q.word].oracle = true;
            SFX.right();
          } else {
            button.classList.add('picked-wrong');     // dim
            all[q.correctIdx].classList.add('reveal-right');  // pink glow
            state.results[q.word].oracle = false;
            recordMistake(q.word);
            SFX.wrong();
          }
          // speak example sentence, then auto-advance (forced linear flow)
          speak(q.sentencePlain).then(() => {
            setTimeout(() => {
              state.oracleIdx++;
              if (state.oracleIdx >= state.oracleQs.length) go('stage2-result');
              else drawQ();
            }, 700);
          });
        }, 280);
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
        <div class="score-header">
          <div class="label">her reading</div>
          <div class="value">${right}<small> / 8</small></div>
        </div>
        <div class="result-grid"></div>
        <div class="stage-actions"></div>
      `;
      sprinkleStars(el, 10);
      el.prepend(moonCorner()); el.appendChild(closeCorner());
      const grid = $('.result-grid', el);
      state.session.words.forEach(w => grid.appendChild(renderExCard(w, state.results[w].oracle, { rewrite: true })));
      const actions = $('.stage-actions', el);
      actions.appendChild(nextDoor('the inscription', () => go('stage3')));
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
      sprinkleStars(el, 10);
      el.prepend(moonCorner()); el.appendChild(closeCorner({ confirm: true }));
      drawQ();

      function drawQ() {
        const stage = $('#dict-stage', el);
        const q = state.session.dict[state.dictIdx];
        const masked = q.prompt.replace(new RegExp(q.answer, 'i'), '____');
        stage.innerHTML = `
          <div class="q-progress">${String(state.dictIdx + 1).padStart(2, '0')} · 08</div>
          <div class="dict-prompt">${escapeHtml(masked)}</div>
          <div class="dict-prompt-zh">${escapeHtml(q.prompt_zh)}</div>
          <div class="dict-hint">${q.hint.toUpperCase()} —</div>
          <input class="dict-input" id="dict-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="…">
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
          input.disabled = true;
          input.classList.add('is-wrong');
          feedback.innerHTML = `correct · <em style="color:var(--gold)">${escapeHtml(q.answer)}</em> · write it once more`;
          feedback.className = 'dict-feedback is-wrong';
          $('#dict-actions', stage).innerHTML = '';
          SFX.wrong();
          stage.insertAdjacentHTML('beforeend', `
            <div class="dict-rewrite-label">— inscribe it —</div>
            <input class="dict-input" id="dict-rewrite" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
          `);
          const rew = $('#dict-rewrite', stage);
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
      el.innerHTML = `
        ${stageHeader(3, 'the inscription')}
        <div class="score-header">
          <div class="label">tonight's reading</div>
          <div class="value">${right}<small> / 8</small></div>
        </div>
        <div class="summary-list" id="summary"></div>
        <div class="result-grid"></div>
        <div class="stage-actions"></div>
      `;
      sprinkleStars(el, 12);

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
      state.session.words.forEach(w => grid.appendChild(renderExCard(w, state.results[w].dict)));

      const actions = $('.stage-actions', el);
      actions.appendChild(nextDoor('next chapter', () => { LanBGM.stop(); go('cover'); }));
      el.prepend(moonCorner()); el.appendChild(closeCorner());
    }
  },

  /* ---------- NOTE (cover-side, NOT in game flow) ---------- */
  note: {
    onEnter() {
      const el = $('#screen-note');
      const m = saved.mistakes;
      const entries = Object.entries(m);
      const buckets = {
        once:   entries.filter(([w, c]) => c === 1).map(([w]) => w),
        twice:  entries.filter(([w, c]) => c === 2).map(([w]) => w),
        thrice: entries.filter(([w, c]) => c === 3).map(([w]) => w),
        haunt:  entries.filter(([w, c]) => c >= 4).map(([w]) => w)
      };
      el.innerHTML = `
        ${titleStrip()}
        ${pageTitle('her little note')}
        <div class="page-subtitle">pages she returns to</div>
        <div class="note-stats">
          <div class="note-stat"><div class="lbl">a single slip</div><div class="val">${buckets.once.length}</div></div>
          <div class="note-stat"><div class="lbl">twice astray</div><div class="val">${buckets.twice.length}</div></div>
          <div class="note-stat"><div class="lbl">thrice undone</div><div class="val">${buckets.thrice.length}</div></div>
          <div class="note-stat warn"><div class="lbl">haunting words</div><div class="val">${buckets.haunt.length}</div></div>
        </div>
        <div id="note-body"></div>
      `;
      sprinkleStars(el, 12);

      const body = $('#note-body', el);
      const show = (label, words) => {
        if (!words.length) return;
        body.insertAdjacentHTML('beforeend', `<div class="section-label">— ${label} —</div>`);
        const wrap = document.createElement('div');
        wrap.className = 'result-grid';
        words.forEach(w => { if (CARDS[w]) wrap.appendChild(renderExCard(w, true)); });
        body.appendChild(wrap);
      };
      if (!entries.length) {
        body.insertAdjacentHTML('beforeend', '<div class="note-empty">no slips yet · the page is still pristine</div>');
      } else {
        show('haunting words', buckets.haunt);
        show('thrice undone',  buckets.thrice);
        show('twice astray',   buckets.twice);
        show('a single slip',  buckets.once);
      }
    }
  },

  /* ---------- INDEX (cover-side, A-Z) ---------- */
  index: {
    onEnter() {
      const el = $('#screen-index');
      const heads = Object.keys(CARDS).sort();
      // group by first letter
      const groups = {};
      heads.forEach(h => {
        const k = h[0].toUpperCase();
        (groups[k] = groups[k] || []).push(h);
      });
      const letters = Object.keys(groups).sort();
      el.innerHTML = `
        ${titleStrip()}
        ${pageTitle('the index')}
        <div class="page-subtitle">every word she has named</div>
        <div class="alpha-bar">${letters.map(L => `<a data-letter="${L}">${L}</a>`).join('')}</div>
        <div id="index-body"></div>
      `;
      sprinkleStars(el, 12);
      $$('.alpha-bar a', el).forEach(a => {
        a.addEventListener('click', () => {
          const L = a.getAttribute('data-letter');
          const target = $(`#letter-${L}`, el);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      const body = $('#index-body', el);
      letters.forEach(L => {
        body.insertAdjacentHTML('beforeend', `<div class="alpha-section-title" id="letter-${L}">${L}</div>`);
        groups[L].forEach(h => {
          const c = CARDS[h];
          const row = document.createElement('div');
          row.className = 'word-row';
          row.innerHTML = `
            <span class="wr-word">${escapeHtml(c.h)}</span>
            <span class="wr-pos">${escapeHtml(c.pos || '')}</span>
            <span class="wr-zh">${escapeHtml(c.zh || '')}</span>
          `;
          row.addEventListener('click', () => {
            SFX.pageTurn();
            go('card', { word: h, from: 'index' });
          });
          body.appendChild(row);
        });
      });
    }
  },

  /* ---------- CARD detail (opened from index, with tarot flip) ---------- */
  card: {
    onEnter(opts) {
      const el = $('#screen-card');
      const word = opts.word;
      const from = opts.from || 'index';
      el.innerHTML = `
        ${titleStrip()}
        <div class="result-grid" id="card-host"></div>
      `;
      sprinkleStars(el, 10);
      $('#card-host', el).appendChild(renderExCard(word, null));
    }
  }
};

/* ============================================================
   12. BOOTSTRAP
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  go('cover');
});
