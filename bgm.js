/*
Lan BGM Pack v3
原创 Web Audio BGM 模块，无需 mp3，浏览器实时合成。

结构：
- 封面 / 主页：5 首长八音盒感随机池
  homeBoxA / homeBoxB / homeBoxC / homeBoxD / homeBoxE
  playHomeRandom()

- 游戏：3 首短循环，活泼快
  gameQuickA / gameQuickB / gameQuickC
  playGameRandom()

- 结算：3 首音乐盒结算感
  resultBoxA / resultBoxB / resultBoxC
  playResultRandom()

页面专用：
- quizGame / quizResult
- dictationGame / dictationResult

用法：
<script src="./lan_bgm_v3.js"></script>

用户点击后：
LanBGM.playHomeRandom({ volume: 0.42 });
LanBGM.playGameRandom({ volume: 0.40 });
LanBGM.playResultRandom({ volume: 0.42 });

注意：
iOS / Chrome 需要用户点击后才能播放声音，不要页面加载自动播放。
*/

window.LanBGM = (() => {
  let ctx = null;
  let master = null;
  let filter = null;
  let delay = null;
  let feedback = null;
  let timer = null;
  let step = 0;
  let playing = false;
  let currentTrack = null;
  let currentTrackId = null;
  let volumeValue = 0.42;

  const N = {
    C2:65.41, Db2:69.30, D2:73.42, Eb2:77.78, E2:82.41, F2:87.31, Gb2:92.50, G2:98.00, Ab2:103.83, A2:110.00, Bb2:116.54, B2:123.47,
    C3:130.81, Db3:138.59, D3:146.83, Eb3:155.56, E3:164.81, F3:174.61, Gb3:185.00, G3:196.00, Ab3:207.65, A3:220.00, Bb3:233.08, B3:246.94,
    C4:261.63, Db4:277.18, D4:293.66, Eb4:311.13, E4:329.63, F4:349.23, Gb4:369.99, G4:392.00, Ab4:415.30, A4:440.00, Bb4:466.16, B4:493.88,
    C5:523.25, Db5:554.37, D5:587.33, Eb5:622.25, E5:659.25, F5:698.46, Gb5:739.99, G5:783.99, Ab5:830.61, A5:880.00, Bb5:932.33, B5:987.77,
    C6:1046.50, Db6:1108.73, D6:1174.66, Eb6:1244.51, E6:1318.51, F6:1396.91, Gb6:1479.98, G6:1567.98, A6:1760.00
  };

  const tracks = {
    homeBoxA: {
      name: "Home Box A",
      group: "home",
      tempo: 82, pulse: 0.75, brightness: 5000, delayTime: 0.38, feedback: 0.33,
      kick:false, hat:false, arpGain:0.105, melodyGain:0.155, padGain:0.075,
      mood:"封面长八音盒 A，清透星空、旧书页",
      melody:[
        "C5",null,"G4",null,"E5",null,"G5",null,"A5",null,"G5",null,"E5",null,"D5",null,
        "C5",null,"E5",null,"G5",null,"C6",null,"B5",null,"G5",null,"E5",null,null,null,
        "A4",null,"C5",null,"E5",null,"A5",null,"G5",null,"E5",null,"D5",null,"C5",null,
        "F5",null,"E5",null,"C5",null,"A4",null,"G4",null,"C5",null,"E5",null,null,null,
        "D5",null,"G5",null,"B5",null,"A5",null,"G5",null,"E5",null,"C5",null,"D5",null,
        "E5",null,"G5",null,"C6",null,"B5",null,"A5",null,"G5",null,"C5",null,null,null
      ],
      bass:[
        "C3",null,null,null,"A2",null,null,null,"F3",null,null,null,"G2",null,null,null,
        "C3",null,null,null,"E3",null,null,null,"F3",null,null,null,"G2",null,null,null
      ],
      chords:[
        ["C4","E4","G4"],null,null,null,["A3","C4","E4"],null,null,null,["F3","A3","C4"],null,null,null,["G3","B3","D4"],null,null,null,
        ["C4","E4","G4"],null,null,null,["E4","G4","B4"],null,null,null,["F4","A4","C5"],null,null,null,["G3","B3","D4"],null,null,null
      ]
    },

    homeBoxB: {
      name:"Home Box B", group:"home",
      tempo:90, pulse:0.75, brightness:5350, delayTime:0.34, feedback:0.30,
      kick:false, hat:false, arpGain:0.11, melodyGain:0.155, padGain:0.07,
      mood:"封面长八音盒 B，梦幻、扑克牌、轻微旋转感",
      melody:[
        "E5",null,"B4",null,"G5",null,"E5",null,"F5",null,"A5",null,"G5",null,"E5",null,
        "D5",null,"F5",null,"A5",null,"C6",null,"B5",null,"A5",null,"F5",null,null,null,
        "G5",null,"E5",null,"C5",null,"E5",null,"A5",null,"G5",null,"E5",null,"D5",null,
        "C5",null,"E5",null,"G5",null,"B5",null,"C6",null,"B5",null,"G5",null,null,null,
        "A5",null,"F5",null,"D5",null,"F5",null,"G5",null,"E5",null,"C5",null,"E5",null,
        "F5",null,"A5",null,"C6",null,"A5",null,"G5",null,"E5",null,"B4",null,null,null
      ],
      bass:[
        "E3",null,null,null,"F3",null,null,null,"D3",null,null,null,"G2",null,null,null,
        "C3",null,null,null,"A2",null,null,null,"F3",null,null,null,"G2",null,null,null
      ],
      chords:[
        ["E4","G4","B4"],null,null,null,["F4","A4","C5"],null,null,null,["D4","F4","A4"],null,null,null,["G3","B3","D4"],null,null,null,
        ["C4","E4","G4"],null,null,null,["A3","C4","E4"],null,null,null,["F3","A3","C4"],null,null,null,["G3","B3","D4"],null,null,null
      ]
    },

    homeBoxC: {
      name:"Home Box C", group:"home",
      tempo:78, pulse:0.75, brightness:4550, delayTime:0.42, feedback:0.36,
      kick:false, hat:false, arpGain:0.10, melodyGain:0.145, padGain:0.08,
      mood:"封面长八音盒 C，安静、停留、像开始页",
      melody:[
        "G4",null,"C5",null,"D5",null,"E5",null,"G5",null,"E5",null,"D5",null,"C5",null,
        "A4",null,"C5",null,"E5",null,"G5",null,"F5",null,"E5",null,"C5",null,null,null,
        "D5",null,"F5",null,"A5",null,"G5",null,"E5",null,"C5",null,"D5",null,"G4",null,
        "C5",null,"E5",null,"G5",null,"C6",null,"B5",null,"G5",null,"C5",null,null,null,
        "E5",null,"D5",null,"C5",null,"A4",null,"G4",null,"A4",null,"C5",null,"D5",null,
        "E5",null,"G5",null,"A5",null,"G5",null,"E5",null,"D5",null,"C5",null,null,null
      ],
      bass:[
        "C3",null,null,null,"F2",null,null,null,"A2",null,null,null,"G2",null,null,null,
        "C3",null,null,null,"A2",null,null,null,"F2",null,null,null,"G2",null,null,null
      ],
      chords:[
        ["C4","E4","G4"],null,null,null,["F3","A3","C4"],null,null,null,["A3","C4","E4"],null,null,null,["G3","B3","D4"],null,null,null,
        ["C4","E4","G4"],null,null,null,["A3","C4","E4"],null,null,null,["F3","A3","C4"],null,null,null,["G3","B3","D4"],null,null,null
      ]
    },

    homeBoxD: {
      name:"Home Box D", group:"home",
      tempo:86, pulse:0.75, brightness:4900, delayTime:0.37, feedback:0.32,
      kick:false, hat:false, arpGain:0.108, melodyGain:0.15, padGain:0.075,
      mood:"封面长八音盒 D，暗童话、兔子怀表、轻微神秘",
      melody:[
        "Eb5",null,"G5",null,"Bb5",null,"G5",null,"F5",null,"Eb5",null,"C5",null,"D5",null,
        "Eb5",null,"G5",null,"C6",null,"Bb5",null,"G5",null,"F5",null,"Eb5",null,null,null,
        "Ab5",null,"G5",null,"Eb5",null,"C5",null,"D5",null,"F5",null,"G5",null,"Bb5",null,
        "C6",null,"Bb5",null,"G5",null,"Eb5",null,"F5",null,"D5",null,"C5",null,null,null,
        "G5",null,"Bb5",null,"C6",null,"Eb6",null,"D6",null,"Bb5",null,"G5",null,"F5",null,
        "Eb5",null,"G5",null,"Bb5",null,"G5",null,"Eb5",null,"D5",null,"C5",null,null,null
      ],
      bass:[
        "C3",null,null,null,"Ab2",null,null,null,"Eb3",null,null,null,"Bb2",null,null,null,
        "C3",null,null,null,"G2",null,null,null,"Ab2",null,null,null,"Bb2",null,null,null
      ],
      chords:[
        ["C4","Eb4","G4"],null,null,null,["Ab3","C4","Eb4"],null,null,null,["Eb4","G4","Bb4"],null,null,null,["Bb3","D4","F4"],null,null,null,
        ["C4","Eb4","G4"],null,null,null,["G3","Bb3","D4"],null,null,null,["Ab3","C4","Eb4"],null,null,null,["Bb3","D4","F4"],null,null,null
      ]
    },

    homeBoxE: {
      name:"Home Box E", group:"home",
      tempo:96, pulse:0.75, brightness:5600, delayTime:0.31, feedback:0.27,
      kick:false, hat:false, arpGain:0.112, melodyGain:0.152, padGain:0.068,
      mood:"封面长八音盒 E，亮一点、像翻开游戏封面",
      melody:[
        "A4",null,"E5",null,"G5",null,"A5",null,"C6",null,"A5",null,"G5",null,"E5",null,
        "F5",null,"A5",null,"C6",null,"D6",null,"C6",null,"A5",null,"F5",null,null,null,
        "E5",null,"G5",null,"B5",null,"C6",null,"B5",null,"G5",null,"E5",null,"D5",null,
        "C5",null,"E5",null,"A5",null,"G5",null,"E5",null,"C5",null,"A4",null,null,null,
        "D5",null,"F5",null,"A5",null,"C6",null,"B5",null,"A5",null,"F5",null,"E5",null,
        "C5",null,"E5",null,"G5",null,"A5",null,"G5",null,"E5",null,"A4",null,null,null
      ],
      bass:[
        "A2",null,null,null,"F3",null,null,null,"E3",null,null,null,"C3",null,null,null,
        "D3",null,null,null,"F3",null,null,null,"G2",null,null,null,"A2",null,null,null
      ],
      chords:[
        ["A3","C4","E4"],null,null,null,["F3","A3","C4"],null,null,null,["E4","G4","B4"],null,null,null,["C4","E4","G4"],null,null,null,
        ["D4","F4","A4"],null,null,null,["F4","A4","C5"],null,null,null,["G3","B3","D4"],null,null,null,["A3","C4","E4"],null,null,null
      ]
    },

    gameQuickA: {
      name:"Game Quick A", group:"game",
      tempo:136, pulse:0.5, brightness:7000, delayTime:0.17, feedback:0.15,
      kick:true, hat:true, arpGain:0.12, melodyGain:0.14, padGain:0.045,
      mood:"游戏短循环 A，选择题感，快、轻、点按钮",
      melody:[
        "E5",null,"G5","A5","C6",null,"B5","G5",
        "A5",null,"G5","E5","D5",null,"E5",null,
        "G5","A5","C6",null,"D6","C6","A5",null,
        "G5","E5","D5","E5","G5",null,"A5",null
      ],
      bass:["C3",null,"G3",null,"A2",null,"E3",null,"F3",null,"C4",null,"G2",null,"D3",null],
      chords:[["C4","E4","G4"],null,["G3","B3","D4"],null,["A3","C4","E4"],null,["E4","G4","B4"],null,["F3","A3","C4"],null,["C4","E4","G4"],null,["G3","B3","D4"],null,["G4","B4","D5"],null]
    },

    gameQuickB: {
      name:"Game Quick B", group:"game",
      tempo:126, pulse:0.5, brightness:6400, delayTime:0.19, feedback:0.16,
      kick:true, hat:true, arpGain:0.11, melodyGain:0.13, padGain:0.045,
      mood:"游戏短循环 B，默写感，快但别吵",
      melody:[
        "D5",null,"F5","A5","C6",null,"A5","F5",
        "G5",null,"F5","D5","C5",null,"D5",null,
        "F5","G5","A5",null,"C6","A5","G5",null,
        "F5","D5","C5","D5","F5",null,"G5",null
      ],
      bass:["D3",null,"A3",null,"Bb2",null,"F3",null,"F3",null,"C4",null,"C3",null,"G3",null],
      chords:[["D4","F4","A4"],null,["A3","C4","E4"],null,["Bb3","D4","F4"],null,["F3","A3","C4"],null,["F4","A4","C5"],null,["C4","E4","G4"],null,["C4","E4","G4"],null,["G3","B3","D4"],null]
    },

    gameQuickC: {
      name:"Game Quick C", group:"game",
      tempo:142, pulse:0.5, brightness:7200, delayTime:0.16, feedback:0.14,
      kick:true, hat:true, arpGain:0.12, melodyGain:0.135, padGain:0.04,
      mood:"游戏短循环 C，更活泼，适合轻快闯关",
      melody:[
        "G5","E5","C5",null,"E5","G5","A5",null,
        "C6",null,"B5","A5","G5",null,"E5",null,
        "F5","A5","C6",null,"A5","G5","F5",null,
        "E5","G5","A5","C6","B5",null,"G5",null
      ],
      bass:["C3",null,"E3",null,"F3",null,"G3",null,"A2",null,"E3",null,"F3",null,"G2",null],
      chords:[["C4","E4","G4"],null,["E4","G4","B4"],null,["F4","A4","C5"],null,["G4","B4","D5"],null,["A3","C4","E4"],null,["E4","G4","B4"],null,["F3","A3","C4"],null,["G3","B3","D4"],null]
    },

    resultBoxA: {
      name:"Result Box A", group:"result",
      tempo:90, pulse:0.75, brightness:5050, delayTime:0.35, feedback:0.31,
      kick:false, hat:false, arpGain:0.112, melodyGain:0.155, padGain:0.075,
      mood:"结算 A，成绩卡，轻轻亮一下",
      melody:[
        "C5",null,"E5",null,"G5",null,"C6",null,"B5",null,"G5",null,"E5",null,"D5",null,
        "A4",null,"C5",null,"E5",null,"A5",null,"G5",null,"E5",null,"C5",null,null,null,
        "F5",null,"A5",null,"C6",null,"A5",null,"G5",null,"E5",null,"D5",null,"C5",null
      ],
      bass:["C3",null,null,null,"G2",null,null,null,"A2",null,null,null,"F3",null,null,null],
      chords:[["C4","E4","G4"],null,null,null,["G3","B3","D4"],null,null,null,["A3","C4","E4"],null,null,null,["F3","A3","C4"],null,null,null]
    },

    resultBoxB: {
      name:"Result Box B", group:"result",
      tempo:84, pulse:0.75, brightness:4550, delayTime:0.40, feedback:0.35,
      kick:false, hat:false, arpGain:0.105, melodyGain:0.15, padGain:0.08,
      mood:"结算 B，写完一页纸，安静一点",
      melody:[
        "D5",null,"A4",null,"F5",null,"E5",null,"D5",null,"C5",null,"A4",null,null,null,
        "Bb4",null,"D5",null,"F5",null,"A5",null,"G5",null,"F5",null,"D5",null,null,null,
        "A4",null,"D5",null,"F5",null,"G5",null,"A5",null,"F5",null,"E5",null,"D5",null
      ],
      bass:["D3",null,null,null,"Bb2",null,null,null,"F3",null,null,null,"C3",null,null,null],
      chords:[["D4","F4","A4"],null,null,null,["Bb3","D4","F4"],null,null,null,["F3","A3","C4"],null,null,null,["C4","E4","G4"],null,null,null]
    },

    resultBoxC: {
      name:"Result Box C", group:"result",
      tempo:96, pulse:0.75, brightness:5300, delayTime:0.33, feedback:0.29,
      kick:false, hat:false, arpGain:0.11, melodyGain:0.152, padGain:0.07,
      mood:"结算 C，偏开心，适合通关后",
      melody:[
        "E5",null,"G5",null,"B5",null,"C6",null,"D6",null,"C6",null,"B5",null,"G5",null,
        "A5",null,"C6",null,"B5",null,"A5",null,"G5",null,"E5",null,"D5",null,null,null,
        "C5",null,"E5",null,"G5",null,"A5",null,"C6",null,"B5",null,"G5",null,"E5",null
      ],
      bass:["C3",null,null,null,"E3",null,null,null,"F3",null,null,null,"G2",null,null,null],
      chords:[["C4","E4","G4"],null,null,null,["E4","G4","B4"],null,null,null,["F4","A4","C5"],null,null,null,["G3","B3","D4"],null,null,null]
    }
  };

  // Page aliases
  tracks.quizGame = tracks.gameQuickA;
  tracks.quizResult = tracks.resultBoxA;
  tracks.dictationGame = tracks.gameQuickB;
  tracks.dictationResult = tracks.resultBoxB;

  const pools = {
    home: ["homeBoxA","homeBoxB","homeBoxC","homeBoxD","homeBoxE"],
    game: ["gameQuickA","gameQuickB","gameQuickC"],
    result: ["resultBoxA","resultBoxB","resultBoxC"]
  };

  function initAudio() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volumeValue;

    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 5200;
    filter.Q.value = 0.7;

    delay = ctx.createDelay();
    feedback = ctx.createGain();

    delay.connect(feedback);
    feedback.connect(delay);
    filter.connect(master);
    filter.connect(delay);
    delay.connect(master);
    master.connect(ctx.destination);
  }

  function applyTrackFX(track) {
    filter.frequency.setValueAtTime(track.brightness || 5200, ctx.currentTime);
    delay.delayTime.setValueAtTime(track.delayTime || 0.28, ctx.currentTime);
    feedback.gain.setValueAtTime(track.feedback ?? 0.24, ctx.currentTime);
  }

  function envGain(t, attack, decay, sustain, release, length, peak = 1) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + attack + decay);
    g.gain.setValueAtTime(Math.max(sustain, 0.0001), t + length);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length + release);
    return g;
  }

  function note(freq, t, length = 0.22, type = "sine", gain = 0.18, detune = 0) {
    const osc = ctx.createOscillator();
    const g = envGain(t, 0.012, 0.08, 0.055, 0.18, length, gain);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.detune.setValueAtTime(detune + (Math.random() - 0.5) * 4, t);
    osc.connect(g);
    g.connect(filter);
    osc.start(t);
    osc.stop(t + length + 0.25);
  }

  function bell(freq, t, length = 0.34, gain = 0.16) {
    note(freq, t, length, "sine", gain, 0);
    note(freq * 2.01, t, length * 0.62, "triangle", gain * 0.22, 0);
  }

  function pad(freqs, t, length = 1.4, gain = 0.07) {
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = envGain(t, 0.25, 0.35, 0.045, 0.7, length, gain);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, t);
      osc.detune.setValueAtTime((i - 1) * 7, t);
      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.9);
    });
  }

  function kick(t) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(96, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  function hat(t) {
    const bufferSize = ctx.sampleRate * 0.032;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.value = 0.025;
    src.connect(hp);
    hp.connect(g);
    g.connect(master);
    src.start(t);
  }

  function schedule() {
    if (!playing || !currentTrack) return;
    const track = currentTrack;
    const unit = 60 / (track.tempo || 96) * (track.pulse || 0.5);
    const now = ctx.currentTime + 0.05;

    const melody = track.melody || [];
    const bass = track.bass || [];
    const chords = track.chords || [];

    const m = melody[step % melody.length];
    if (m && N[m]) bell(N[m], now, unit * 1.45, track.melodyGain ?? 0.15);

    const b = bass[step % bass.length];
    if (b && N[b]) note(N[b], now, unit * 2.2, "triangle", track.arpGain ?? 0.10);

    const c = chords[step % chords.length];
    if (Array.isArray(c)) pad(c.map(n => N[n]).filter(Boolean), now, unit * 5.2, track.padGain ?? 0.07);

    if (track.kick && step % 8 === 0) kick(now);
    if (track.hat && step % 4 === 2) hat(now);

    step++;
    timer = setTimeout(schedule, unit * 1000);
  }

  async function play(trackId = "homeBoxA", options = {}) {
    initAudio();
    await ctx.resume();
    const next = tracks[trackId] || tracks.homeBoxA;
    currentTrack = next;
    currentTrackId = trackId;
    applyTrackFX(next);

    if (typeof options.volume === "number") setVolume(options.volume);

    if (!playing) {
      playing = true;
      step = options.reset === false ? step : 0;
      schedule();
    } else {
      step = 0;
    }
    return currentTrackId;
  }

  async function playRandom(poolName, options = {}) {
    const pool = pools[poolName] || pools.home;
    let id = pool[Math.floor(Math.random() * pool.length)];
    if (options.avoidRepeat !== false && currentTrackId && pool.length > 1) {
      let guard = 0;
      while (id === currentTrackId && guard < 8) {
        id = pool[Math.floor(Math.random() * pool.length)];
        guard++;
      }
    }
    await play(id, options);
    return id;
  }

  function playHomeRandom(options = {}) { return playRandom("home", options); }
  function playGameRandom(options = {}) { return playRandom("game", options); }
  function playResultRandom(options = {}) { return playRandom("result", options); }

  function stop() {
    playing = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function setVolume(v = 0.42) {
    volumeValue = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = volumeValue;
  }

  function getCurrentTrackId() { return currentTrackId; }

  function listTracks() {
    return Object.fromEntries(
      Object.entries(tracks)
        .filter(([id]) => !["quizGame","quizResult","dictationGame","dictationResult"].includes(id))
        .map(([id, t]) => [id, { name: t.name, group: t.group, mood: t.mood, tempo: t.tempo }])
    );
  }

  return {
    play,
    playHomeRandom,
    playGameRandom,
    playResultRandom,
    stop,
    setVolume,
    getCurrentTrackId,
    listTracks,
    tracks
  };
})();
