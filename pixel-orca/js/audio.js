/* ============================================================
   PIXEL ORCA — 8-bit аудио (WebAudio, без файлов)
   SFX: синтезированные «квадраты» и шум.
   Музыка: секвенсор 8-битного лупа.
   ============================================================ */
(function (root) {
  'use strict';

  var ctx = null, master = null, sfxGain = null, musGain = null;
  var musicOn = false, sfxOn = true, volume = 0.5;
  var musicTimer = null, musicStep = 0, musicNextTime = 0;

  var NOTES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function freq(name) {
    if (name === '-' || !name) return 0;
    var m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return 0;
    var semi = NOTES[m[1].toLowerCase()];
    if (m[2] === '#') semi++;
    if (m[2] === 'b') semi--;
    var oct = parseInt(m[3], 10);
    return 440 * Math.pow(2, (semi - 9) / 12 + (oct - 4));
  }

  function init() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.85;
    sfxGain.connect(master);
    musGain = ctx.createGain();
    musGain.gain.value = 0.32;
    musGain.connect(master);
    return ctx;
  }

  function resume() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* ---------- примитивы ---------- */
  function tone(opts) {
    if (!ctx || !sfxOn) return;
    var t0 = opts.at || ctx.currentTime;
    var dur = opts.dur || 0.12;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opts.type || 'square';
    osc.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t0 + dur);
    var vol = (opts.vol == null ? 0.25 : opts.vol);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  var noiseBuf = null;
  function noise(opts) {
    if (!ctx || !sfxOn) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t0 = opts.at || ctx.currentTime;
    var dur = opts.dur || 0.15;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = opts.filter || 'highpass';
    f.frequency.setValueAtTime(opts.f0 || 1200, t0);
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.f1), t0 + dur);
    var g = ctx.createGain();
    var vol = opts.vol == null ? 0.18 : opts.vol;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  function seq(notes, type, step, vol) {
    var t = ctx.currentTime;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (!n) continue;
      tone({ f0: freq(n[0]), dur: n[1] * step, type: type, vol: vol, at: t, f1: n[2] ? freq(n[2]) : 0 });
      t += n[1] * step;
    }
  }

  /* ---------- SFX ---------- */
  var clickCount = 0;
  var SFX = {
    click: function () {
      clickCount++;
      var p = [0, 2, 4, 7, 9];
      var semi = p[clickCount % p.length];
      tone({ f0: 420 + semi * 22, f1: 300 + semi * 18, dur: 0.06, type: 'square', vol: 0.16 });
      noise({ dur: 0.04, f0: 2600, vol: 0.05 });
    },
    crit: function () {
      tone({ f0: 300, f1: 1600, dur: 0.18, type: 'sawtooth', vol: 0.22 });
      noise({ dur: 0.2, f0: 700, f1: 4000, vol: 0.16 });
      tone({ f0: 1600, f1: 2400, dur: 0.12, type: 'square', vol: 0.1, at: ctx ? ctx.currentTime + 0.06 : 0 });
    },
    levelUp: function () {
      if (!ctx || !sfxOn) return;
      seq([['c5', 1], ['e5', 1], ['g5', 1], ['c6', 2]], 'square', 0.07, 0.2);
      seq([['c4', 1], ['e4', 1], ['g4', 1], ['c5', 2]], 'triangle', 0.07, 0.12);
    },
    buy: function () {
      if (!ctx || !sfxOn) return;
      seq([['g4', 1], ['c5', 1], ['e5', 2]], 'square', 0.06, 0.18);
    },
    deny: function () {
      if (!ctx || !sfxOn) return;
      tone({ f0: 180, f1: 90, dur: 0.14, type: 'square', vol: 0.14 });
    },
    ui: function () {
      tone({ f0: 900, f1: 1200, dur: 0.035, type: 'square', vol: 0.08 });
    },
    box: function () {
      if (!ctx || !sfxOn) return;
      var t = ctx.currentTime;
      noise({ at: t, dur: 0.25, f0: 400, f1: 3000, vol: 0.14 });
      tone({ at: t, f0: 200, f1: 900, dur: 0.3, type: 'square', vol: 0.12 });
      var notes = [['c5', 1], ['e5', 1], ['g5', 1], ['c6', 1], ['e6', 3]];
      seq(notes, 'square', 0.075, 0.2);
    },
    rare: function () {
      if (!ctx || !sfxOn) return;
      var t = ctx.currentTime;
      seq([['c6', 1], ['g6', 1], ['c7', 4]], 'square', 0.06, 0.22);
      noise({ at: t, dur: 0.5, f0: 2000, f1: 6000, vol: 0.08 });
    },
    fish: function () {
      noise({ dur: 0.3, f0: 500, f1: 2600, vol: 0.14 });
      tone({ f0: 300, f1: 900, dur: 0.12, type: 'triangle', vol: 0.12 });
    },
    catchFish: function () {
      if (!ctx || !sfxOn) return;
      seq([['e5', 1], ['a5', 1], ['c6', 2]], 'triangle', 0.06, 0.18);
    },
    bonus: function () {
      if (!ctx || !sfxOn) return;
      seq([['a4', 1], ['c5', 1], ['e5', 1], ['a5', 1], ['c6', 3]], 'square', 0.06, 0.2);
    },
    win: function () {
      if (!ctx || !sfxOn) return;
      seq([['c5', 1], ['e5', 1], ['g5', 1], ['c6', 1], ['g5', 1], ['c6', 4]], 'square', 0.075, 0.22);
    },
    lose: function () {
      if (!ctx || !sfxOn) return;
      seq([['g4', 1], ['e4', 1], ['c4', 1], ['a3', 4]], 'square', 0.09, 0.18);
    },
    prestige: function () {
      if (!ctx || !sfxOn) return;
      var t = ctx.currentTime;
      ['c4', 'e4', 'g4', 'c5', 'e5', 'g5', 'c6'].forEach(function (n, i) {
        tone({ f0: freq(n), dur: 0.5, type: 'square', vol: 0.14, at: t + i * 0.07 });
        tone({ f0: freq(n) / 2, dur: 0.5, type: 'triangle', vol: 0.1, at: t + i * 0.07 });
      });
      noise({ at: t, dur: 0.9, f0: 500, f1: 5000, vol: 0.07 });
    },
    battle: function () {
      if (!ctx || !sfxOn) return;
      tone({ f0: 120, f1: 60, dur: 0.4, type: 'sawtooth', vol: 0.2 });
      noise({ dur: 0.4, f0: 200, f1: 100, vol: 0.1 });
    },
    tick: function () {
      tone({ f0: 1500, dur: 0.02, type: 'square', vol: 0.07 });
    }
  };

  function play(name) {
    if (!init()) return;
    resume();
    if (!sfxOn) return;
    var f = SFX[name];
    if (f) { try { f(); } catch (e) { /* ignore */ } }
  }

  /* ---------- МУЗЫКА: 8-бит луп ---------- */
  var LEAD = [
    // такт 1
    'a4 - c5 - e5 - a5 -', 'g5 - e5 - c5 - b4 -',
    // такт 2
    'c5 - d5 - f5 - a5 -', 'g5 - e5 - d5 - c5 -',
    // такт 3
    'e5 - g5 - a5 - c6 -', 'b5 - a5 - g5 - e5 -',
    // такт 4
    'f5 - e5 - d5 - c5 -', 'b4 - c5 - d5 - e5 -',
    // такт 5
    'a4 - a5 - c5 - e5 -', 'a5 - g5 - e5 - c5 -',
    // такт 6
    'd5 - f5 - a5 - d6 -', 'c6 - a5 - f5 - d5 -',
    // такт 7
    'e5 - a5 - g5 - e5 -', 'd5 - e5 - f5 - g5 -',
    // такт 8
    'a5 - - - - - -'
  ];
  var BASS = [
    'a2 - a2 - e2 - e2 -', 'a2 - e2 - a2 - a2 -',
    'a2 - a2 - e2 - e2 -', 'f2 - e2 - a2 - a2 -',
    'a2 - a2 - e2 - e2 -', 'd2 - d2 - a2 - a2 -',
    'f2 - f2 - c3 - c3 -', 'e2 - e2 - a2 - a2 -'
  ];
  var STEP = 0.135; /* 16-я нота при ~110 BPM */

  function playStep(step, at) {
    var bar = Math.floor(step / 8) % 8;
    var inBar = step % 8;
    var leadRow = LEAD[bar].split(' ');
    var bassRow = BASS[bar].split(' ');
    var ln = leadRow[inBar];
    if (ln && ln !== '-') {
      tone({ f0: freq(ln) * 2, dur: STEP * 1.6, type: 'square', vol: 0.055, at: at });
      tone({ f0: freq(ln), dur: STEP * 1.6, type: 'triangle', vol: 0.05, at: at });
    }
    if (inBar % 2 === 0) {
      var bn = bassRow[inBar];
      if (bn && bn !== '-') tone({ f0: freq(bn), dur: STEP * 1.7, type: 'triangle', vol: 0.09, at: at });
    }
    if (inBar === 0 || inBar === 4) {
      noise({ dur: 0.1, f0: 180, f1: 60, vol: 0.11, at: at, filter: 'lowpass' });
    }
    if (inBar % 2 === 1) noise({ dur: 0.035, f0: 5000, vol: 0.035, at: at });
  }

  function schedule() {
    if (!musicOn || !ctx) return;
    var horizon = ctx.currentTime + 0.25;
    while (musicNextTime < horizon) {
      playStep(musicStep, musicNextTime);
      musicStep++;
      musicNextTime += STEP;
    }
  }

  function startMusic() {
    if (!init()) return;
    resume();
    if (musicTimer) return;
    musicStep = 0;
    musicNextTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(schedule, 40);
    schedule();
  }

  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  root.SND = {
    init: init, resume: resume, play: play,
    get enabled() { return sfxOn; },
    set enabled(v) { sfxOn = !!v; },
    get music() { return musicOn; },
    set music(v) {
      musicOn = !!v;
      if (musicOn) startMusic(); else stopMusic();
    },
    set volume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = volume;
    },
    get volume() { return volume; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
