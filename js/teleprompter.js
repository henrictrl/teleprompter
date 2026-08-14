// Motor de rolagem do teleprompter — usa scrollTop nativo do navegador
// (não mais transform), com dois modos:
//
//  - "timer": rolagem contínua numa velocidade constante calculada a
//    partir do ppm escolhido — o comportamento clássico de teleprompter.
//  - "follow": a rolagem é guiada por fora (chamando scrollToWord),
//    acompanhando a posição real da palavra que o reconhecimento de
//    voz confirmou — não usa tempo/velocidade pra decidir quando rolar.
//
// Em qualquer um dos dois modos, o cronômetro (activeSeconds) só serve
// pra registrar quanto tempo a sessão durou de verdade, não controla
// mais a rolagem sozinho.

export function createTeleprompter({ viewport, content, minWpm = 60, maxWpm = 600 }) {
  let wpm = 130;
  let totalWords = 1;
  let playing = false;
  let mode = 'timer'; // 'timer' | 'follow'
  let rafId = null;
  let followRafId = null;
  let lastTs = null;
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

  function emitTick() {
    const max = maxScroll();
    if (onTick) onTick({ progress: max ? viewport.scrollTop / max : 0, activeSeconds: activeMs / 1000 });
  }

  function checkFinished() {
    const max = maxScroll();
    if (viewport.scrollTop >= max && max > 0) {
      viewport.scrollTop = max;
      playing = false;
      finished = true;
      emitTick();
      if (onFinish) onFinish({ activeSeconds: activeMs / 1000 });
      return true;
    }
    return false;
  }

  // Laço principal: sempre roda enquanto "playing", pra manter o
  // cronômetro contando e o progresso/timecode atualizados. Só mexe
  // no scroll de verdade quando o modo é "timer" — em modo "follow"
  // quem move o scroll é scrollToWord(), chamado de fora.
  function step(ts) {
    if (!playing) return;
    if (lastTs == null) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    activeMs += dt;

    if (mode === 'timer') {
      viewport.scrollTop += pxPerMs * dt;
      if (checkFinished()) return;
    }

    emitTick();
    rafId = requestAnimationFrame(step);
  }

  // Anima o scroll até a posição real de um elemento (palavra),
  // deixando ele numa faixa fixa perto do topo da área de leitura —
  // usado no modo "follow", guiado pelo reconhecimento de voz.
  function scrollToWord(el, durationMs = 420) {
    if (!el) return;
    if (followRafId) cancelAnimationFrame(followRafId);
    const positionRatio = 0.38;
    const max = maxScroll();
    const target = Math.max(0, Math.min(max, el.offsetTop - viewport.clientHeight * positionRatio));
    const start = viewport.scrollTop;
    const change = target - start;
    if (Math.abs(change) < 1) return;
    const startTs = performance.now();

    function animate(ts) {
      const elapsed = ts - startTs;
      const p = Math.min(elapsed / durationMs, 1);
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      viewport.scrollTop = start + change * ease;
      if (p < 1) {
        followRafId = requestAnimationFrame(animate);
      } else {
        followRafId = null;
        checkFinished();
      }
    }
    followRafId = requestAnimationFrame(animate);
  }

  const api = {
    setContentMeta(words) {
      totalWords = Math.max(1, words);
      recalcSpeed();
    },
    setMode(next) {
      mode = next === 'follow' ? 'follow' : 'timer';
      lastTs = null; // evita um dt gigante quando volta pro modo timer
    },
    getMode() {
      return mode;
    },
    scrollToWord(el) {
      scrollToWord(el);
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
      if (followRafId) cancelAnimationFrame(followRafId);
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
      return max ? viewport.scrollTop / max : 0;
    },
    seekToProgress(p) {
      const max = maxScroll();
      viewport.scrollTop = Math.max(0, Math.min(1, p)) * max;
      finished = viewport.scrollTop >= max && max > 0;
      emitTick();
    },
    getActiveSeconds() {
      return activeMs / 1000;
    },
    getRemainingSeconds() {
      const max = maxScroll();
      const remainingPx = Math.max(0, max - viewport.scrollTop);
      return pxPerMs > 0 ? remainingPx / pxPerMs / 1000 : 0;
    },
    getTotalSeconds() {
      return (totalWords / wpm) * 60;
    },
    reset() {
      playing = false;
      finished = false;
      mode = 'timer';
      if (rafId) cancelAnimationFrame(rafId);
      if (followRafId) cancelAnimationFrame(followRafId);
      viewport.scrollTop = 0;
      activeMs = 0;
      lastTs = null;
      recalcSpeed();
    },
    onFinish(cb) { onFinish = cb; },
    onTick(cb) { onTick = cb; },
  };

  return api;
}
