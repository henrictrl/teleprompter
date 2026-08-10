// Motor de rolagem do teleprompter. Calcula a velocidade em pixels/ms
// a partir do "ppm" (palavras por minuto) e da altura total do texto,
// e anima com requestAnimationFrame.

export function createTeleprompter({ viewport, content, minWpm = 60, maxWpm = 600 }) {
  let wpm = 130;
  let totalWords = 1;
  let playing = false;
  let rafId = null;
  let lastTs = null;
  let scrollTop = 0;
  let activeMs = 0;
  let pxPerMs = 0;
  let finished = false;

  let onFinish = null;
  let onTick = null;

  function maxScroll() {
    return Math.max(0, content.scrollHeight - viewport.clientHeight);
  }

  function recalcSpeed() {
    const totalTimeMs = (totalWords / wpm) * 60000;
    pxPerMs = totalTimeMs > 0 ? maxScroll() / totalTimeMs : 0;
  }

  function applyTransform() {
    content.style.transform = `translateY(-${scrollTop}px)`;
  }

  function step(ts) {
    if (!playing) return;
    if (lastTs == null) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    activeMs += dt;

    scrollTop += pxPerMs * dt;
    const max = maxScroll();

    if (scrollTop >= max) {
      scrollTop = max;
      applyTransform();
      playing = false;
      finished = true;
      if (onTick) onTick({ progress: 1, activeSeconds: activeMs / 1000 });
      if (onFinish) onFinish({ activeSeconds: activeMs / 1000 });
      return;
    }

    applyTransform();
    if (onTick) onTick({ progress: max ? scrollTop / max : 0, activeSeconds: activeMs / 1000 });
    rafId = requestAnimationFrame(step);
  }

  const api = {
    setContentMeta(words) {
      totalWords = Math.max(1, words);
      recalcSpeed();
    },
    play() {
      if (playing || finished) return;
      playing = true;
      lastTs = null;
      rafId = requestAnimationFrame(step);
    },
    pause() {
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
    },
    toggle() {
      if (playing) api.pause();
      else api.play();
    },
    isPlaying() {
      return playing;
    },
    setWpm(next) {
      wpm = Math.max(minWpm, Math.min(maxWpm, Math.round(next)));
      recalcSpeed();
      return wpm;
    },
    getWpm() {
      return wpm;
    },
    getProgress() {
      const max = maxScroll();
      return max ? scrollTop / max : 0;
    },
    seekToProgress(p) {
      const max = maxScroll();
      scrollTop = Math.max(0, Math.min(1, p)) * max;
      finished = scrollTop >= max && max > 0;
      applyTransform();
      if (onTick) onTick({ progress: max ? scrollTop / max : 0, activeSeconds: activeMs / 1000 });
    },
    getActiveSeconds() {
      return activeMs / 1000;
    },
    getRemainingSeconds() {
      const max = maxScroll();
      const remainingPx = Math.max(0, max - scrollTop);
      return pxPerMs > 0 ? remainingPx / pxPerMs / 1000 : 0;
    },
    getTotalSeconds() {
      return (totalWords / wpm) * 60;
    },
    reset() {
      playing = false;
      finished = false;
      if (rafId) cancelAnimationFrame(rafId);
      scrollTop = 0;
      activeMs = 0;
      lastTs = null;
      applyTransform();
      recalcSpeed();
    },
    onFinish(cb) { onFinish = cb; },
    onTick(cb) { onTick = cb; },
  };

  return api;
}
