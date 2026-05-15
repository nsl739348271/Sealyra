/* ============================================================
   Her Little Lexicon — app.js
   Logic ONLY. No visual styling. Keep the structure tidy so that
   visual tweaks live in styles.css and never touch this file.
   ============================================================ */

/* ------------------------------------------------------------
   0. SMALL UTILITIES
   ------------------------------------------------------------ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function rand(arr)  { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Browser TTS (English example sentences / phrases) */
function speak(text, lang = 'en-US') {
  if (!window.speechSynthesis) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.92;
    u.pitch = 1.0;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

/* one-shot SFX synth — used for the "card flip" / "submit" / "ding" / "wrong" cues.
   No mp3s, just Web Audio. */
const SFX = (() => {
  let ctx = null;
  const ensure = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx; };
  function tone(freqs, dur = 0.22, type = 'sine', gain = 0.18) {
    const c = ensure();
    const t0 = c.currentTime;
    freqs.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t0 + i * 0.04);
      g.gain.setValueAtTime(0.0001, t0 + i * 0.04);
      g.gain.exponentialRampToValueAtTime(gain, t0 + i * 0.04 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.04 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0 + i * 0.04);
      o.stop(t0 + i * 0.04 + dur + 0.05);
    });
  }
  return {
    bling:    () => tone([1318, 1760, 2349], 0.32, 'sine',     0.16),  // cover begin / tarot
    flip:     () => tone([880, 1320],         0.10, 'triangle', 0.10),  // every card-flip
    confirm:  () => tone([523, 880],          0.18, 'sine',     0.14),  // pink confirm
    popup:    () => tone([784, 988, 1318],    0.24, 'triangle', 0.14),  // modal pop
    correct:  () => tone([880, 1175, 1568],   0.26, 'sine',     0.18),  // right answer
    wrong:    () => tone([311, 207],          0.22, 'square',   0.07),  // wrong answer (soft)
    finish:   () => tone([523, 659, 784, 988, 1175], 0.28, 'sine', 0.16) // chapter clear
  };
})();

/* ------------------------------------------------------------
   1. CHAPTER SETUP — pick 8 words per chapter
   Pick words that exist in CARDS + GROUPS + DICT_QUESTIONS so all
   three stages reference the same 8 words.
   ------------------------------------------------------------ */
const CHAPTERS = (() => {
  const groupMap = new Map(GROUPS.map(g => [g.head, g.partner]));
  const dictMap  = new Map(DICT_QUESTIONS.map(d => [d.head, d]));
  const allHeads = Object.keys(CARDS).filter(h =>
    groupMap.has(h) && dictMap.has(h)
  );

  // Sort alphabetically for reproducibility; group into 8s
  const sorted = allHeads.sort();
  const out = [];
  for (let i = 0; i < 3; i++) {                 // we cap at 3 chapters for v1
    const slice = sorted.slice(i * 8, i * 8 + 8);
    if (slice.length < 8) break;
    out.push({
      number: i + 1,
      words:  slice,
      pairs:  slice.map(h => ({ head: h, partner: groupMap.get(h) })),
      dict:   slice.map(h => dictMap.get(h))
    });
  }
  return out;
})();

/* ------------------------------------------------------------
   2. APP STATE
   ------------------------------------------------------------ */
const state = {
  screen: 'cover',
  chapterIdx: 0,
  // each chapter accumulates word-level results across the 3 stages
  results: {},   // results[chapterIdx][word] = { match: bool, oracle: bool, dict: bool }
  mistakes: loadMistakes()  // global archive: { word: timesWrong }
};

function ensureChapterRecord(idx) {
  if (!state.results[idx]) {
    state.results[idx] = {};
    CHAPTERS[idx].words.forEach(w => {
      state.results[idx][w] = { match: null, oracle: null, dict: null };
    });
  }
}

function loadMistakes() {
  try { return JSON.parse(localStorage.getItem('hll-mistakes') || '{}'); }
  catch { return {}; }
}
function saveMistakes() {
  try { localStorage.setItem('hll-mistakes', JSON.stringify(state.mistakes)); } catch {}
}
function recordMistake(word) {
  state.mistakes[word] = (state.mistakes[word] || 0) + 1;
  saveMistakes();
}

/* ------------------------------------------------------------
   3. ROUTER — show/hide screens
   ------------------------------------------------------------ */
function go(screenId, options = {}) {
  state.screen = screenId;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${screenId}`));
  window.scrollTo(0, 0);
  if (Screens[screenId] && Screens[screenId].onEnter) Screens[screenId].onEnter(options);
}

/* ------------------------------------------------------------
   4. DECORATIONS — sprinkle stars / moon into a screen container
   ------------------------------------------------------------ */
function sprinkleStars(container, count = 14) {
  if (!container || container.querySelector('.deco-stars')) return;
  const layer = document.createElement('div');
  layer.className = 'deco-stars';
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'star';
    s.style.top  = (Math.random() * 100) + '%';
    s.style.left = (Math.random() * 100) + '%';
    s.style.animationDelay = (Math.random() * 4) + 's';
    s.style.transform = `scale(${0.6 + Math.random() * 0.9})`;
    s.innerHTML = SVG.star;
    layer.appendChild(s);
  }
  container.prepend(layer);
}

/* ------------------------------------------------------------
   5. SVG asset slots — replace with real PNGs later if desired
   ------------------------------------------------------------ */
const SVG = {
  star:
    `<svg viewBox="0 0 24 24" class="svg-icon" fill="currentColor"><path d="M12 2 L13.6 9 L21 10 L15 14.5 L17 22 L12 17.5 L7 22 L9 14.5 L3 10 L10.4 9 Z"/></svg>`,
  moon:
    `<svg viewBox="0 0 64 64" class="svg-icon" fill="currentColor"><path d="M44 8c-9 4-15 13-15 24s6 20 15 24c-2 .7-4 1-6 1-13.8 0-25-11.2-25-25S24.2 7 38 7c2 0 4 .3 6 1z"/></svg>`,
  key:
    `<svg viewBox="0 0 32 32" class="svg-icon" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="10" r="5"/>
      <circle cx="10" cy="10" r="2" fill="currentColor"/>
      <path d="M14 12 L26 22 M21 17 L19 19 M24 20 L22 22"/>
    </svg>`,
  bow:
    `<svg viewBox="0 0 100 40" class="svg-icon" fill="currentColor" opacity="0.85">
      <path d="M50 20 C 38 8 18 4 12 12 C 6 20 14 28 26 30 C 38 32 46 26 50 20 Z"/>
      <path d="M50 20 C 62 8 82 4 88 12 C 94 20 86 28 74 30 C 62 32 54 26 50 20 Z"/>
      <ellipse cx="50" cy="20" rx="5" ry="6"/>
      <path d="M48 26 L42 38 M52 26 L58 38" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>`,
  speaker:
    `<svg viewBox="0 0 24 24" class="svg-icon" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4zm12 3a4 4 0 0 0-2-3.5v7A4 4 0 0 0 16 12z"/></svg>`,
  back:
    `<svg viewBox="0 0 24 24" class="svg-icon" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6 L9 12 L15 18"/></svg>`,
  close:
    `<svg viewBox="0 0 24 24" class="svg-icon" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>`
};

/* ------------------------------------------------------------
   6. BUTTON HELPERS — tarot-card-style buttons with flip on tap
   ------------------------------------------------------------ */
function cardButton({ text, sub, className = '', onClick }) {
  const btn = document.createElement('button');
  btn.className = 'btn-card ' + className;
  btn.innerHTML = sub
    ? `<span class="ch-num">${sub}</span><span class="ch-title">${text}</span>`
    : text;
  btn.addEventListener('click', e => {
    btn.classList.remove('is-flipping');
    void btn.offsetWidth;       // restart animation
    btn.classList.add('is-flipping');
    SFX.flip();
    setTimeout(() => onClick && onClick(e), 240);
  });
  return btn;
}
function confirmButton(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'btn-confirm';
  btn.textContent = label;
  btn.addEventListener('click', e => {
    btn.classList.remove('is-engaged');
    void btn.offsetWidth;
    btn.classList.add('is-engaged');
    SFX.confirm();
    setTimeout(() => onClick && onClick(e), 200);
  });
  return btn;
}

/* The "Tonight's Reading" / next-stage launcher — keys flank the label */
function tonightButton(label, onClick) {
  const row = document.createElement('div');
  row.className = 'tonight-btn-row';
  const keyL = document.createElement('span');
  keyL.className = 'tonight-key';
  keyL.innerHTML = SVG.key;
  const keyR = document.createElement('span');
  keyR.className = 'tonight-key right';
  keyR.innerHTML = SVG.key;
  const btn = document.createElement('button');
  btn.className = 'btn-card';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    btn.classList.remove('is-flipping');
    void btn.offsetWidth;
    btn.classList.add('is-flipping');
    SFX.flip();
    setTimeout(() => onClick && onClick(), 240);
  });
  row.appendChild(keyL);
  row.appendChild(btn);
  row.appendChild(keyR);
  return row;
}

/* ------------------------------------------------------------
   7. SHARED PIECES — banner, title block, top-nav
   ------------------------------------------------------------ */
function buildBanner(text) {
  return `<div class="banner"><div class="banner-title">${text}</div></div>`;
}

function buildTitleBlock(title, sub = '', { small = false } = {}) {
  return `
    <div class="title-wrap">
      <div class="title-line">
        <span class="title-text${small ? ' small' : ''}">${title}</span>
      </div>
      ${sub ? `<div class="title-sub">${sub}</div>` : ''}
      <div class="title-bow">${SVG.bow}</div>
    </div>`;
}

function buildTopNav(onBack) {
  const wrap = document.createElement('div');
  wrap.className = 'top-nav';
  const left = document.createElement('div');
  if (onBack) {
    const back = document.createElement('button');
    back.className = 'btn-ghost';
    back.innerHTML = `${SVG.back} back`;
    back.addEventListener('click', onBack);
    left.appendChild(back);
  }
  const right = document.createElement('div');
  right.className = 'right-cluster';
  const mute = document.createElement('button');
  mute.className = 'btn-ghost';
  mute.textContent = '— hush —';
  mute.addEventListener('click', () => {
    LanBGM.stop();
    mute.textContent = '— silent —';
  });
  right.appendChild(mute);
  wrap.appendChild(left);
  wrap.appendChild(right);
  return wrap;
}

/* ------------------------------------------------------------
   8. SCREENS
   Each screen exposes onEnter(opts). All DOM goes inside its element.
   Render fresh each time so the screens stay independent.
   ------------------------------------------------------------ */
const Screens = {

  /* ---------- 8.1 COVER ---------- */
  cover: {
    onEnter() {
      const el = $('#screen-cover');
      el.innerHTML = `
        <div class="cover-stage">
          <div class="cover-content" id="cover-content">
            ${buildTitleBlock(`Tonight&rsquo;s Reading`, 'words come softly, when she calls them')}
            <div id="cover-begin"></div>
          </div>
          <div class="cover-blank-hint" id="cover-hint">tap anywhere to begin</div>
        </div>
      `;
      sprinkleStars(el, 22);
      // floating moon, top-right
      const moon = document.createElement('div');
      moon.className = 'deco-moon';
      moon.innerHTML = SVG.moon;
      el.appendChild(moon);

      const hint    = $('#cover-hint', el);
      const content = $('#cover-content', el);

      // STEP 1: tap anywhere to wake the page (allows audio per autoplay rules)
      const wake = () => {
        el.removeEventListener('click', wake);
        hint.style.display = 'none';
        content.classList.add('visible');
        SFX.bling();
        LanBGM.playHomeRandom({ volume: 0.42 });
        renderBeginButton();
      };
      el.addEventListener('click', wake);

      function renderBeginButton() {
        const slot = $('#cover-begin', el);
        const btn = document.createElement('button');
        btn.className = 'btn-card';
        btn.textContent = 'begin';
        btn.addEventListener('click', () => {
          btn.classList.add('is-engaged');
          SFX.bling();
          // fade music + fade-to-black, then go to index
          const fade = document.createElement('div');
          fade.className = 'fade-out';
          document.body.appendChild(fade);
          requestAnimationFrame(() => fade.classList.add('show'));
          setTimeout(() => LanBGM.stop(), 900);
          setTimeout(() => {
            go('index');
            // next screen plays short bgm and breathes on entry
            LanBGM.playHomeRandom({ volume: 0.38 });
            setTimeout(() => fade.remove(), 800);
            fade.classList.remove('show');
          }, 1100);
        });
        slot.appendChild(btn);
      }
    }
  },

  /* ---------- 8.2 INDEX ---------- */
  index: {
    onEnter() {
      const el = $('#screen-index');
      el.innerHTML = '';
      el.appendChild(buildTopNav(null));
      el.insertAdjacentHTML('beforeend', buildBanner('— her little lexicon —'));
      el.insertAdjacentHTML('beforeend', buildTitleBlock(`Tonight&rsquo;s Reading`, 'pick a chapter', { small: true }));

      const list = document.createElement('div');
      list.className = 'chapter-list';
      CHAPTERS.forEach((ch, i) => {
        const ready = state.results[i] && Object.values(state.results[i]).some(r => r.match !== null);
        const btn = cardButton({
          sub:  `chapter · ${ch.number}`,
          text: i === 0 ? 'the opening pages' : i === 1 ? 'the silver thread' : 'the candle hour',
          onClick: () => {
            state.chapterIdx = i;
            ensureChapterRecord(i);
            go('chapter');
          }
        });
        list.appendChild(btn);
      });
      el.appendChild(list);

      // bottom: note book
      const bottom = document.createElement('div');
      bottom.className = 'center-col';
      bottom.style.marginTop = '32px';
      const noteBtn = cardButton({
        text: 'her little note',
        sub:  '— archive —',
        onClick: () => go('note')
      });
      noteBtn.style.minWidth = '220px';
      bottom.appendChild(noteBtn);
      el.appendChild(bottom);

      sprinkleStars(el, 16);
    }
  },

  /* ---------- 8.3 CHAPTER INTRO ---------- */
  chapter: {
    onEnter() {
      const el = $('#screen-chapter');
      const ch = CHAPTERS[state.chapterIdx];
      el.innerHTML = '';
      el.appendChild(buildTopNav(() => go('index')));
      el.insertAdjacentHTML('beforeend', buildBanner(`— chapter · ${ch.number} —`));

      const intro = document.createElement('div');
      intro.className = 'chapter-intro';
      intro.innerHTML = `
        <div class="chapter-label">chapter · ${ch.number}</div>
        <div class="chapter-stage-name">the pairing</div>
        <div class="chapter-mood">eight little words, four soft pairs.<br/>match what dreams together.</div>
      `;
      intro.appendChild(tonightButton(`tonight&rsquo;s reading`, () => {
        ensureChapterRecord(state.chapterIdx);
        go('match');
      }));
      el.appendChild(intro);
      sprinkleStars(el, 12);
    }
  },

  /* ---------- 8.4 MATCH GAME ---------- */
  match: {
    onEnter() {
      LanBGM.playGameRandom({ volume: 0.40 });   // short, brisk loop
      const el = $('#screen-match');
      const ch = CHAPTERS[state.chapterIdx];
      // 4 pairs, 8 cards, mixed (left=heads / right=partners) — present shuffled
      const pairs = ch.pairs.slice(0, 4); // first 4 of the chapter's 8
      const cards = [];
      pairs.forEach((p, i) => {
        cards.push({ text: p.head,    pairId: i, side: 'L' });
        cards.push({ text: p.partner, pairId: i, side: 'R' });
      });
      const shuffled = shuffle(cards);
      const matchState = {
        cards: shuffled,
        tagOf: new Array(shuffled.length).fill(null),   // 0..3 or null
        currentTag: 0
      };

      el.innerHTML = '';
      el.appendChild(buildTopNav(() => go('chapter')));
      el.insertAdjacentHTML('beforeend', buildBanner(`— chapter ${ch.number} · the pairing —`));
      el.insertAdjacentHTML('beforeend', `
        <div class="q-progress">tap two cards to dye them the same colour · four pairs</div>
      `);

      const grid = document.createElement('div');
      grid.className = 'match-grid';
      shuffled.forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = 'match-card';
        card.setAttribute('data-stage', '1');
        card.textContent = c.text;
        card.addEventListener('click', () => paint(idx, card));
        grid.appendChild(card);
      });
      el.appendChild(grid);

      const actionRow = document.createElement('div');
      actionRow.className = 'center-col';
      actionRow.style.marginTop = '20px';
      const confirm = confirmButton('confirm', () => submit());
      actionRow.appendChild(confirm);
      el.appendChild(actionRow);

      function paint(idx, card) {
        // remove old tag
        for (let i = 0; i < 4; i++) card.classList.remove('tag-' + i);
        // assign next color: continue the current "pair" or start a new one
        const tagged = matchState.tagOf;
        const sameTagCount = tagged.filter(t => t === matchState.currentTag).length;
        if (tagged[idx] !== null) {
          tagged[idx] = null;
        } else {
          if (sameTagCount >= 2) {
            // current colour is full → advance to next colour
            matchState.currentTag = (matchState.currentTag + 1) % 4;
          }
          tagged[idx] = matchState.currentTag;
        }
        // restyle every card from tagOf
        $$('.match-card', grid).forEach((node, i) => {
          for (let k = 0; k < 4; k++) node.classList.remove('tag-' + k);
          if (tagged[i] !== null) node.classList.add('tag-' + tagged[i]);
        });
        card.classList.remove('is-flipping'); void card.offsetWidth; card.classList.add('is-flipping');
        SFX.flip();

        // if current full and another untagged card was tapped, currentTag bumped above
        // but we need to bump again if it just became full
        const nowSame = tagged.filter(t => t === matchState.currentTag).length;
        if (nowSame >= 2) matchState.currentTag = (matchState.currentTag + 1) % 4;
      }

      function submit() {
        // score: for each tag (0..3), the two cards that share that tag must be a pair
        const tags = matchState.tagOf;
        if (tags.some(t => t === null)) {
          showModal({ title: 'not yet, dear', body: 'colour every card first.', actions: [{ label: 'okay', primary: true }] });
          return;
        }
        let correct = 0;
        const cardResult = new Array(shuffled.length).fill(false);
        for (let t = 0; t < 4; t++) {
          const idxs = tags.map((v, i) => v === t ? i : -1).filter(i => i >= 0);
          if (idxs.length !== 2) continue;
          const [a, b] = idxs;
          if (shuffled[a].pairId === shuffled[b].pairId) {
            correct++;
            cardResult[a] = true; cardResult[b] = true;
          }
        }
        // record per-word results
        shuffled.forEach((c, i) => {
          const word = c.side === 'L' ? c.text : pairs[c.pairId].head;
          if (cardResult[i]) {
            // only count once per pair (left side cards "own" the word)
            if (c.side === 'L') state.results[state.chapterIdx][c.text].match = true;
          } else {
            if (c.side === 'L') {
              state.results[state.chapterIdx][c.text].match = false;
              recordMistake(c.text);
            }
          }
        });
        SFX.popup();
        showModal({
          title: 'pages flipped',
          score: { value: correct, total: 4 },
          actions: [{ label: 'see results', primary: true, onClick: () => go('match-result') }]
        });
      }
    }
  },

  /* ---------- 8.5 MATCH RESULT ---------- */
  'match-result': {
    onEnter() {
      LanBGM.playResultRandom({ volume: 0.42 });  // cheerful music-box
      const el = $('#screen-match-result');
      const ch = CHAPTERS[state.chapterIdx];
      const wordsHere = ch.words.slice(0, 4); // the 4 heads used in match stage
      const results = state.results[state.chapterIdx];
      const right = wordsHere.filter(w => results[w].match).length;

      el.innerHTML = '';
      el.appendChild(buildTopNav(() => go('chapter')));
      el.insertAdjacentHTML('beforeend', buildBanner(`— chapter ${ch.number} · the pairing —`));
      el.insertAdjacentHTML('beforeend', `
        <div class="score-header">
          <div class="label">the pairing</div>
          <div class="value">${right}<small> / 4</small></div>
        </div>
      `);
      const list = document.createElement('div');
      list.className = 'result-grid';
      wordsHere.forEach(w => list.appendChild(renderVocabCard(w, results[w].match)));
      el.appendChild(list);

      const ar = document.createElement('div');
      ar.className = 'center-col';
      ar.style.marginTop = '24px';
      ar.appendChild(confirmButton('next  ·  the reading', () => {
        go('oracle');
      }));
      el.appendChild(ar);
    }
  },

  /* ---------- 8.6 ORACLE GAME ---------- */
  oracle: {
    onEnter() {
      LanBGM.playHomeRandom({ volume: 0.38 });   // quiet music-box for reading
      const el = $('#screen-oracle');
      const ch = CHAPTERS[state.chapterIdx];
      const items = ch.words.map(w => buildOracleQuestion(w));
      const stateQ = { i: 0, items };

      el.innerHTML = '';
      el.appendChild(buildTopNav(() => go('chapter')));
      el.insertAdjacentHTML('beforeend', buildBanner(`— chapter ${ch.number} · the reading —`));
      const stage = document.createElement('div');
      stage.className = 'oracle-stage';
      el.appendChild(stage);

      drawQ();

      function drawQ() {
        const q = stateQ.items[stateQ.i];
        stage.innerHTML = `
          <div class="q-progress">${String(stateQ.i + 1).padStart(2, '0')} · 08</div>
          <div class="q-sentence"><em>${escapeHtml(q.sentenceHL)}</em></div>
          <div class="oracle-options"></div>
          <div class="oracle-tap-hint">tap anywhere to continue</div>
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

      function pick(oi, btn) {
        const q = stateQ.items[stateQ.i];
        const allBtns = $$('.oracle-option', stage);
        allBtns.forEach(b => b.disabled = true);
        if (oi === q.correctIdx) {
          btn.classList.add('picked-right');
          state.results[state.chapterIdx][q.word].oracle = true;
          SFX.correct();
        } else {
          btn.classList.add('picked-wrong');
          allBtns[q.correctIdx].classList.add('reveal-right');
          state.results[state.chapterIdx][q.word].oracle = false;
          recordMistake(q.word);
          SFX.wrong();
        }
        // speak the example sentence
        speak(q.sentencePlain).then(() => {
          $('.oracle-tap-hint', stage).classList.add('show');
        });
        // wait for tap anywhere
        const advance = (e) => {
          if (e.target.closest('.btn-ghost')) return;
          stage.removeEventListener('click', advance);
          if (stateQ.i + 1 >= stateQ.items.length) {
            go('oracle-result');
          } else {
            stateQ.i++;
            drawQ();
          }
        };
        // delay so first click doesn't double-trigger
        setTimeout(() => stage.addEventListener('click', advance), 600);
      }
    }
  },

  /* ---------- 8.7 ORACLE RESULT ---------- */
  'oracle-result': {
    onEnter() {
      LanBGM.playResultRandom({ volume: 0.42 });
      const el = $('#screen-oracle-result');
      const ch = CHAPTERS[state.chapterIdx];
      const results = state.results[state.chapterIdx];
      const right = ch.words.filter(w => results[w].oracle).length;

      el.innerHTML = '';
      el.appendChild(buildTopNav(() => go('chapter')));
      el.insertAdjacentHTML('beforeend', buildBanner(`— chapter ${ch.number} · the reading —`));
      el.insertAdjacentHTML('beforeend', `
        <div class="score-header">
          <div class="label">the reading</div>
          <div class="value">${right}<small> / 8</small></div>
        </div>
      `);
      const list = document.createElement('div');
      list.className = 'result-grid';
      ch.words.forEach(w => list.appendChild(renderVocabCard(w, results[w].oracle, { rewrite: true })));
      el.appendChild(list);

      const ar = document.createElement('div');
      ar.className = 'center-col';
      ar.style.marginTop = '24px';
      ar.appendChild(confirmButton('next  ·  the inscription', () => {
        go('dict');
      }));
      el.appendChild(ar);
    }
  },

  /* ---------- 8.8 DICTATION GAME ---------- */
  dict: {
    onEnter() {
      LanBGM.playGameRandom({ volume: 0.40 });
      const el = $('#screen-dict');
      const ch = CHAPTERS[state.chapterIdx];
      const items = ch.dict;
      const stateD = { i: 0, items, awaitRewrite: false };

      el.innerHTML = '';
      el.appendChild(buildTopNav(() => go('chapter')));
      el.insertAdjacentHTML('beforeend', buildBanner(`— chapter ${ch.number} · the inscription —`));
      const stage = document.createElement('div');
      stage.className = 'dict-stage';
      el.appendChild(stage);

      drawQ();

      function drawQ() {
        const q = stateD.items[stateD.i];
        // Build prompt with the answer blanked out as a long underline
        const masked = q.prompt.replace(new RegExp(q.answer, 'i'), '____');
        stage.innerHTML = `
          <div class="q-progress">${String(stateD.i + 1).padStart(2, '0')} · 08</div>
          <div class="dict-prompt">${escapeHtml(masked)}</div>
          <div class="dict-prompt-zh">${escapeHtml(q.prompt_zh)}</div>
          <div class="dict-hint">${q.hint.toUpperCase()} —</div>
          <input class="dict-input" id="dict-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="…" />
          <div class="dict-feedback" id="dict-feedback"></div>
          <div class="dict-actions" id="dict-actions">
          </div>
        `;
        const input = $('#dict-input', stage);
        const actions = $('#dict-actions', stage);
        const submit = confirmButton('write', () => check());
        actions.appendChild(submit);
        input.focus();
        input.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
      }

      function check() {
        const q = stateD.items[stateD.i];
        const input = $('#dict-input', stage);
        const feedback = $('#dict-feedback', stage);
        const guess = input.value.trim().toLowerCase();
        if (!guess) return;
        if (guess === q.answer.toLowerCase()) {
          // CORRECT — complete the phrase, speak it, advance
          state.results[state.chapterIdx][q.word === undefined ? q.head : q.head].dict = true;
          input.disabled = true;
          input.classList.remove('is-wrong');
          feedback.textContent = `${q.prompt}`;
          feedback.className = 'dict-feedback is-correct';
          $('#dict-actions', stage).innerHTML = '';
          SFX.correct();
          speak(q.prompt).then(() => {
            setTimeout(advance, 700);
          });
        } else {
          // WRONG — show correct answer, require rewrite
          input.disabled = true;
          input.classList.add('is-wrong');
          state.results[state.chapterIdx][q.head].dict = false;
          recordMistake(q.head);
          SFX.wrong();
          feedback.innerHTML = `correct  ·  <em style="color:var(--flesh)">${escapeHtml(q.answer)}</em>  ·  write it once more`;
          feedback.className = 'dict-feedback is-wrong';
          $('#dict-actions', stage).innerHTML = '';
          // rewrite input
          stage.insertAdjacentHTML('beforeend', `
            <div class="dict-rewrite-label">— inscribe it —</div>
            <input class="dict-input" id="dict-rewrite" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
          `);
          const rew = $('#dict-rewrite', stage);
          rew.focus();
          rew.addEventListener('input', () => {
            if (rew.value.trim().toLowerCase() === q.answer.toLowerCase()) {
              rew.disabled = true;
              feedback.textContent = `${q.prompt}`;
              feedback.className = 'dict-feedback is-correct';
              SFX.correct();
              speak(q.prompt).then(() => setTimeout(advance, 700));
            }
          });
        }
      }

      function advance() {
        if (stateD.i + 1 >= stateD.items.length) {
          go('dict-result');
        } else {
          stateD.i++;
          drawQ();
        }
      }
    }
  },

  /* ---------- 8.9 DICTATION RESULT  /  CHAPTER SUMMARY ---------- */
  'dict-result': {
    onEnter() {
      LanBGM.playResultRandom({ volume: 0.42 });
      const el = $('#screen-dict-result');
      const ch = CHAPTERS[state.chapterIdx];
      const results = state.results[state.chapterIdx];
      const right = ch.words.filter(w => results[w].dict).length;

      el.innerHTML = '';
      el.appendChild(buildTopNav(() => go('chapter')));
      el.insertAdjacentHTML('beforeend', buildBanner(`— chapter ${ch.number} · summary —`));
      el.insertAdjacentHTML('beforeend', `
        <div class="score-header">
          <div class="label">the inscription</div>
          <div class="value">${right}<small> / 8</small></div>
        </div>
      `);

      // chapter-wide summary — one row per word, three ticks
      const list = document.createElement('div');
      list.className = 'summary-list';
      const renderTick = (v) =>
        v === null ? `<div class="tick">—</div>`
                   : `<div class="tick ${v ? 'ok' : 'bad'}">${v ? '✓' : '✗'}</div>`;
      ch.words.forEach(w => {
        const r = results[w];
        const row = document.createElement('div');
        row.className = 'summary-row';
        row.innerHTML = `
          <div class="sum-word">${escapeHtml(w)}</div>
          ${renderTick(r.match)}
          ${renderTick(r.oracle)}
          ${renderTick(r.dict)}
        `;
        list.appendChild(row);
      });
      el.appendChild(list);

      // cards for full review
      const cards = document.createElement('div');
      cards.className = 'result-grid';
      ch.words.forEach(w => cards.appendChild(renderVocabCard(w, results[w].dict)));
      el.appendChild(cards);

      const ar = document.createElement('div');
      ar.className = 'center-col';
      ar.style.marginTop = '24px';

      const isLast = state.chapterIdx + 1 >= CHAPTERS.length;
      if (isLast) {
        ar.appendChild(confirmButton('close the book', () => {
          LanBGM.stop();
          SFX.finish();
          go('index');
        }));
      } else {
        ar.appendChild(confirmButton('next chapter', () => {
          SFX.finish();
          state.chapterIdx++;
          ensureChapterRecord(state.chapterIdx);
          go('chapter');
        }));
      }
      el.appendChild(ar);
    }
  },

  /* ---------- 8.10 NOTE (mistake archive) ---------- */
  note: {
    onEnter() {
      const el = $('#screen-note');
      el.innerHTML = '';
      el.appendChild(buildTopNav(() => go('index')));
      el.insertAdjacentHTML('beforeend', buildBanner('— her little note —'));
      el.insertAdjacentHTML('beforeend', buildTitleBlock('Her Little Note', 'pages she returns to', { small: true }));

      const m = state.mistakes;
      const all = Object.entries(m);
      const buckets = {
        once:   all.filter(([w, c]) => c === 1).map(([w]) => w),
        twice:  all.filter(([w, c]) => c === 2).map(([w]) => w),
        thrice: all.filter(([w, c]) => c === 3).map(([w]) => w),
        haunt:  all.filter(([w, c]) => c >= 4).map(([w]) => w)
      };

      const stats = document.createElement('div');
      stats.className = 'note-stats';
      stats.innerHTML = `
        <div class="note-stat-card"><div class="nsc-label">a single slip</div><div class="nsc-value">${buckets.once.length}</div></div>
        <div class="note-stat-card"><div class="nsc-label">twice astray</div><div class="nsc-value">${buckets.twice.length}</div></div>
        <div class="note-stat-card"><div class="nsc-label">thrice undone</div><div class="nsc-value">${buckets.thrice.length}</div></div>
        <div class="note-stat-card is-warn"><div class="nsc-label">haunting words</div><div class="nsc-value">${buckets.haunt.length}</div></div>
      `;
      el.appendChild(stats);

      const show = (label, words) => {
        if (!words.length) return;
        el.insertAdjacentHTML('beforeend', `<div class="note-section-title">— ${label} —</div>`);
        const list = document.createElement('div');
        list.className = 'note-list';
        words.forEach(w => { if (CARDS[w]) list.appendChild(renderVocabCard(w, true)); });
        el.appendChild(list);
      };
      if (!all.length) {
        el.insertAdjacentHTML('beforeend', '<div class="note-empty">no slips yet · the page is still pristine</div>');
      } else {
        show('haunting words', buckets.haunt);
        show('thrice undone',  buckets.thrice);
        show('twice astray',   buckets.twice);
        show('a single slip',  buckets.once);
      }
    }
  }
};

/* ------------------------------------------------------------
   9. VOCAB CARD RENDERER
   - speak-button anchored to the leftmost position of the head row.
   - family terms: pink, colloc terms: flesh-warm. zh values: deep-violet song-italic.
   - English head/family words italicised; phrases (colloc) not italicised.
   ------------------------------------------------------------ */
function renderVocabCard(headWord, isRight, opts = {}) {
  const c = CARDS[headWord];
  if (!c) {
    const x = document.createElement('div');
    x.className = 'vocab-card';
    x.textContent = headWord;
    return x;
  }
  const box = document.createElement('div');
  box.className = 'vocab-card ' + (isRight ? 'is-correct' : 'is-wrong');

  /* Head row — speak | word | pos */
  const head = document.createElement('div');
  head.className = 'vc-head';
  head.innerHTML = `
    <button class="speak-btn" data-speak="${escapeAttr(c.example || c.h)}">${SVG.speaker}</button>
    <span class="vc-word">${escapeHtml(c.h)}</span>
    <span class="vc-pos">${escapeHtml(c.pos || '')}</span>
    <span class="vc-zh-inline">${escapeHtml(c.zh || '')}</span>
  `;
  box.appendChild(head);

  /* Family (single-words; italicised, pink) */
  if (c.family && c.family.length) {
    const fam = document.createElement('div');
    fam.className = 'vc-family';
    fam.innerHTML = `<div class="vc-family-title">family</div>` + c.family.map(line => {
      const [w, pos, ex, ezh] = line.split('|').map(s => s.trim());
      return `<div><span class="term">${escapeHtml(w)}</span> <span class="vc-pos">${escapeHtml(pos)}</span> · ${escapeHtml(ex)}<span class="vc-zh-inline">${escapeHtml(ezh || '')}</span></div>`;
    }).join('');
    box.appendChild(fam);
  }

  /* Collocation (phrases; not italicised, flesh-warm) */
  if (c.colloc && c.colloc.length) {
    const co = document.createElement('div');
    co.className = 'vc-colloc';
    co.innerHTML = `<div class="vc-colloc-title">collocation</div>` + c.colloc.map(line => {
      const [phrase, zh] = line.split('|').map(s => s.trim());
      return `<div><span class="term" style="font-style:normal">${escapeHtml(phrase)}</span><span class="vc-zh-inline">${escapeHtml(zh || '')}</span></div>`;
    }).join('');
    box.appendChild(co);
  }

  /* Example */
  if (c.example) {
    const ex = document.createElement('div');
    ex.className = 'vc-example';
    ex.innerHTML = `${escapeHtml(c.example)}<div class="vc-example-zh">${escapeHtml(c.example_zh || '')}</div>`;
    box.appendChild(ex);
  }

  /* Optional rewrite box (oracle result) */
  if (opts.rewrite) {
    const rw = document.createElement('div');
    rw.className = 'vc-rewrite';
    rw.innerHTML = `
      <div class="vc-rewrite-label">— write it once —</div>
      <input type="text" placeholder="${escapeAttr(c.h)}" autocomplete="off" />
    `;
    box.appendChild(rw);
  }

  /* speak button — clicking plays the saved attribute */
  box.querySelectorAll('.speak-btn').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const text = b.getAttribute('data-speak');
      speak(text);
    });
  });

  return box;
}

/* ------------------------------------------------------------
   10. ORACLE QUESTION BUILDER
   Show example sentence, italicised, with the head word emphasised.
   Right answer = c.zh. Wrong answers = sampled from other CARDS.zh.
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
  const correctIdx = options.indexOf(c.zh);

  return { word, sentencePlain: sentence, sentenceHL, options, correctIdx };
}

/* ------------------------------------------------------------
   11. MODAL
   ------------------------------------------------------------ */
function showModal({ title, body = '', score = null, actions = [] }) {
  const veil = $('#modal');
  veil.innerHTML = `
    <div class="modal-card">
      <div class="modal-title">${title}</div>
      ${score ? `<div class="modal-score">${score.value}<small> / ${score.total}</small></div>` : ''}
      ${body  ? `<div class="modal-body">${body}</div>` : ''}
      <div class="modal-actions"></div>
    </div>
  `;
  const ar = $('.modal-actions', veil);
  actions.forEach(a => {
    const btn = a.primary
      ? confirmButton(a.label, () => { hideModal(); a.onClick && a.onClick(); })
      : cardButton({ text: a.label, onClick: () => { hideModal(); a.onClick && a.onClick(); } });
    ar.appendChild(btn);
  });
  veil.classList.add('show');
}
function hideModal() { $('#modal').classList.remove('show'); }

/* ------------------------------------------------------------
   12. ESCAPING
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s); }

/* ------------------------------------------------------------
   13. BOOTSTRAP
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  go('cover');
});
