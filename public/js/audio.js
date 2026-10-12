/* ===== audio.js — 音效與背景音樂（全部用 WebAudio 即時合成，沒有外部音檔）=====
 * 棋子落在木盤上是「叩」的一聲（短噪音＋低頻正弦），翻面是輕脆的「嗒」。
 * 背景音樂是安靜的五聲音階慢板，隨機但不會吵。瀏覽器要求先有使用者手勢，第一次點擊時才解鎖。
 */
(function (root) {
  'use strict';
  let ctx = null, master = null, sfxBus = null, musBus = null, noiseBuf = null;
  let sfxOn = true, musicOn = true, sfxVol = 0.8, musVol = 0.5, vibrateOn = true;
  let musicTimer = null, nextNote = 0, step = 0, started = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.gain.value = sfxVol; sfxBus.connect(master);
      musBus = ctx.createGain(); musBus.gain.value = musicOn ? musVol * 0.35 : 0; musBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!started) { started = true; if (musicOn) startMusic(); }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => root.addEventListener(ev, unlock, { passive: true }));

  function tone(freq, t0, dur, type, gain, dest, slide) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || sfxBus); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function click(t0, freq, q, dur, gain) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t0); s.stop(t0 + dur + 0.02);
  }

  const SFX = {
    place(t) { click(t, 1500, 1.4, 0.07, 0.9); tone(170, t, 0.12, 'sine', 0.55, null, 90); tone(520, t, 0.05, 'triangle', 0.12); },
    flip(t) { const j = 1 + (Math.random() - 0.5) * 0.18; click(t, 2600 * j, 3, 0.04, 0.35); tone(980 * j, t, 0.05, 'triangle', 0.08); },
    land(t) { click(t, 1900, 2, 0.035, 0.22); },
    select(t) { tone(660, t, 0.06, 'triangle', 0.14); },
    error(t) { tone(150, t, 0.16, 'square', 0.1, null, 110); },
    pass(t) { tone(440, t, 0.12, 'sine', 0.2, null, 330); tone(330, t + 0.12, 0.16, 'sine', 0.2, null, 247); },
    turn(t) { tone(784, t, 0.12, 'sine', 0.16); tone(1175, t + 0.08, 0.16, 'sine', 0.12); },
    chat(t) { tone(900, t, 0.05, 'sine', 0.1); },
    start(t) { [392, 523, 659].forEach((f, i) => tone(f, t + i * 0.09, 0.2, 'triangle', 0.18)); },
    win(t) { [523, 659, 784, 1047].forEach((f, i) => { tone(f, t + i * 0.12, 0.5, 'triangle', 0.22); tone(f / 2, t + i * 0.12, 0.5, 'sine', 0.12); }); },
    lose(t) { [392, 349, 311, 262].forEach((f, i) => tone(f, t + i * 0.18, 0.55, 'sine', 0.2)); },
    draw(t) { [440, 440, 494].forEach((f, i) => tone(f, t + i * 0.16, 0.3, 'triangle', 0.18)); }
  };
  function play(name) {
    if (!sfxOn || !ensure() || ctx.state !== 'running') return;
    const f = SFX[name]; if (f) { try { f(ctx.currentTime + 0.005); } catch (e) { /* ignore */ } }
  }
  function buzz(ms) { if (vibrateOn && root.navigator && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } }

  /* ---- 背景音樂：D 大調五聲音階，慢速隨機琶音＋低音 ---- */
  const SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99];
  function scheduleMusic() {
    if (!ctx || !musicOn) return;
    while (nextNote < ctx.currentTime + 0.6) {
      const beat = 0.62;
      if (step % 8 === 0) { const root = [146.83, 130.81, 110, 123.47][(step / 8 | 0) % 4]; tone(root, nextNote, 3.2, 'sine', 0.5, musBus); tone(root * 2, nextNote, 3.2, 'sine', 0.18, musBus); }
      if (Math.random() < 0.72) tone(SCALE[(Math.random() * SCALE.length) | 0], nextNote, 1.6, 'triangle', 0.22, musBus);
      nextNote += beat; step++;
    }
  }
  function startMusic() { if (!ensure() || musicTimer) return; nextNote = ctx.currentTime + 0.1; musicTimer = setInterval(scheduleMusic, 200); scheduleMusic(); }
  function stopMusic() { clearInterval(musicTimer); musicTimer = null; }

  root.Sound = {
    play, buzz, unlock,
    setSfx(on, vol) { sfxOn = !!on; if (vol != null) sfxVol = vol; if (sfxBus) sfxBus.gain.value = sfxOn ? sfxVol : 0; },
    setMusic(on, vol) {
      musicOn = !!on; if (vol != null) musVol = vol;
      if (musBus) musBus.gain.value = musicOn ? musVol * 0.35 : 0;
      if (musicOn && started) startMusic(); else if (!musicOn) stopMusic();
    },
    setVibrate(on) { vibrateOn = !!on; }
  };
})(typeof self !== 'undefined' ? self : this);
