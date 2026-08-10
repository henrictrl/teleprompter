import { LANGS, TOPICS, buildScript } from './wikipedia.js';
import { getCache, saveToCache, deleteFromCache, getHistory, addHistoryEntry, getStats } from './storage.js';
import { createTeleprompter } from './teleprompter.js';
import { isSupported as micIsSupported, createSpeechChecker, normalizeWord, tokenize } from './speech.js';

// ---------- estado ----------
const state = {
  lang: 'en',
  topic: 'random',
  duration: 2,
  wpmSetting: 130,
};
let currentScript = null;
let sessionLogged = false;
let fontSize = 34;
let wordEls = [];
let scriptWordsNorm = [];
let expectedIndex = 0;
let micOn = false;
let micUsedThisSession = false;
let sessionCorrectCount = 0;
let sessionMissedWords = [];

// ---------- refs: tela de configuração ----------
const topicSelect = document.getElementById('topic-select');
const wpmRange = document.getElementById('wpm-range');
const wpmValue = document.getElementById('wpm-value');
const btnGenerate = document.getElementById('btn-generate');
const genStatus = document.getElementById('generate-status');
const libraryList = document.getElementById('library-list');
const libraryEmpty = document.getElementById('library-empty');
const statsSummary = document.getElementById('stats-summary');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');

// ---------- refs: tela de leitura ----------
const screenSetup = document.getElementById('screen-setup');
const screenReader = document.getElementById('screen-reader');
const viewport = document.getElementById('viewport');
const contentEl = document.getElementById('content');
const timecodeEl = document.getElementById('timecode');
const progressFill = document.getElementById('progress-fill');
const btnPlayPause = document.getElementById('btn-playpause');
const wpmReadout = document.getElementById('wpm-readout');
const btnBack = document.getElementById('btn-back');
const btnSpeedUp = document.getElementById('btn-speed-up');
const btnSpeedDown = document.getElementById('btn-speed-down');
const btnFontUp = document.getElementById('btn-font-up');
const btnFontDown = document.getElementById('btn-font-down');
const btnMic = document.getElementById('btn-mic');
const liveCaption = document.getElementById('live-caption');
const progressTrack = document.getElementById('progress-track');

const prompter = createTeleprompter({ viewport, content: contentEl, minWpm: 60, maxWpm: 600 });

function syncPlayButton() {
  btnPlayPause.textContent = prompter.isPlaying() ? '❚❚' : '▶';
}

// ---------- helpers ----------
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatRelativeDate(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `há ${diffD} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function topicLabel(id) {
  return (TOPICS.find(t => t.id === id) || {}).label || id;
}

// ---------- tela de configuração ----------
TOPICS.forEach(t => {
  const opt = document.createElement('option');
  opt.value = t.id;
  opt.textContent = t.label;
  topicSelect.appendChild(opt);
});

function wireSeg(containerId, onChange) {
  const el = document.getElementById(containerId);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    el.querySelectorAll('.seg-btn').forEach(b => {
      b.classList.remove('is-selected');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('is-selected');
    btn.setAttribute('aria-checked', 'true');
    onChange(btn.dataset.value);
  });
}
wireSeg('field-lang', v => { state.lang = v; });
wireSeg('field-duration', v => { state.duration = parseInt(v, 10); });

topicSelect.addEventListener('change', () => { state.topic = topicSelect.value; });

function updateRangeFill(rangeEl) {
  const min = Number(rangeEl.min);
  const max = Number(rangeEl.max);
  const pct = ((Number(rangeEl.value) - min) / (max - min)) * 100;
  rangeEl.style.background = `linear-gradient(to right, var(--text-dim) 0%, var(--text-dim) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

wpmRange.addEventListener('input', () => {
  state.wpmSetting = parseInt(wpmRange.value, 10);
  wpmValue.textContent = state.wpmSetting;
  updateRangeFill(wpmRange);
});
updateRangeFill(wpmRange);

btnGenerate.addEventListener('click', async () => {
  btnGenerate.disabled = true;
  genStatus.classList.remove('is-error');
  genStatus.textContent = 'Buscando texto na Wikipédia…';
  try {
    const targetWords = Math.round(state.duration * state.wpmSetting);
    const script = await buildScript(state.lang, state.topic, targetWords);
    saveToCache(script);
    genStatus.textContent = script.usedFallback
      ? 'Não achei textos nesse tema — usei um artigo aleatório.'
      : '';
    renderLibrary();
    openReader(script);
  } catch (err) {
    genStatus.classList.add('is-error');
    genStatus.textContent = (err && err.message) || 'Deu erro ao buscar o texto. Tenta de novo.';
  } finally {
    btnGenerate.disabled = false;
  }
});

function renderLibrary() {
  const cache = getCache();
  libraryEmpty.style.display = cache.length ? 'none' : '';
  libraryList.innerHTML = cache.map(entry => `
    <li class="list-item">
      <div class="list-item-main">
        <div class="list-item-title">${escapeHTML(entry.title)}</div>
        <div class="list-item-meta">${LANGS[entry.lang]?.label || entry.lang} · ${topicLabel(entry.topic)} · ${entry.wordCount} palavras · ${formatRelativeDate(entry.createdAt)}</div>
      </div>
      <div class="list-item-actions">
        <button type="button" class="list-item-btn" data-action="read" data-id="${entry.id}">Ler</button>
        <button type="button" class="list-item-btn" data-action="delete" data-id="${entry.id}">Excluir</button>
      </div>
    </li>
  `).join('');
}

libraryList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'delete') {
    deleteFromCache(id);
    renderLibrary();
    return;
  }
  if (btn.dataset.action === 'read') {
    const entry = getCache().find(c => c.id === id);
    if (entry) openReader(entry);
  }
});

function tallyWords(words) {
  const counts = new Map();
  words.forEach(w => {
    const key = w.toLowerCase();
    if (!counts.has(key)) counts.set(key, { word: w, count: 0 });
    counts.get(key).count++;
  });
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

function chipRow(items) {
  return `<div class="chip-row">${items.map(({ word, count }) =>
    `<span class="chip">${escapeHTML(word)}${count > 1 ? `<span class="chip-count">×${count}</span>` : ''}</span>`
  ).join('')}</div>`;
}

function renderTopMissed(stats) {
  const container = document.getElementById('top-missed');
  const langs = Object.keys(stats.topMissedByLang || {}).filter(l => stats.topMissedByLang[l].length);
  if (!langs.length) { container.innerHTML = ''; return; }
  container.innerHTML = langs.map(lang => `
    <div class="top-missed-group">
      <div class="top-missed-label">Palavras que mais escapam — ${LANGS[lang]?.label || lang}</div>
      ${chipRow(stats.topMissedByLang[lang])}
    </div>
  `).join('');
}

function renderHistory() {
  const stats = getStats();
  statsSummary.innerHTML = `
    <div class="stat-item"><span class="stat-value mono">${stats.totalSessions}</span><span class="stat-label">sessões</span></div>
    <div class="stat-item"><span class="stat-value mono">${stats.totalMinutes}</span><span class="stat-label">min. lidos</span></div>
    <div class="stat-item"><span class="stat-value mono">${stats.completionRate}%</span><span class="stat-label">concluídas</span></div>
    <div class="stat-item"><span class="stat-value mono">${stats.avgAccuracy === null ? '—' : stats.avgAccuracy + '%'}</span><span class="stat-label">precisão de voz</span></div>
  `;
  renderTopMissed(stats);

  const history = getHistory();
  historyEmpty.style.display = history.length ? 'none' : '';
  historyList.innerHTML = history.slice(0, 8).map(h => {
    const mins = Math.round(((h.activeSeconds || 0) / 60) * 10) / 10;
    const hasMic = h.micUsed && (h.wordsTracked || 0) > 0;
    const accuracy = hasMic ? Math.round((h.wordsCorrect / h.wordsTracked) * 100) : null;

    const metaParts = [LANGS[h.lang]?.label || h.lang, `${mins} min`];
    if (h.completed) metaParts.push('concluído');
    if (accuracy !== null) metaParts.push(`${accuracy}% reconhecido`);
    metaParts.push(formatRelativeDate(h.at));

    const missedTally = hasMic && h.missedWords && h.missedWords.length ? tallyWords(h.missedWords) : [];
    const detail = missedTally.length ? `
      <details class="history-detail">
        <summary>${missedTally.length} palavra${missedTally.length === 1 ? '' : 's'} não reconhecida${missedTally.length === 1 ? '' : 's'}</summary>
        ${chipRow(missedTally)}
      </details>
    ` : '';

    return `
      <li class="list-item">
        <div class="list-item-main">
          <div class="list-item-title">${escapeHTML(h.title || 'Texto')}</div>
          <div class="list-item-meta">${metaParts.join(' · ')}</div>
          ${detail}
        </div>
      </li>
    `;
  }).join('');
}

// ---------- tela de leitura ----------
function renderContentText(text) {
  contentEl.style.fontSize = fontSize + 'px';
  contentEl.innerHTML = '';
  wordEls = [];
  scriptWordsNorm = [];
  text.split(/\n{2,}/).filter(Boolean).forEach(paragraph => {
    const pEl = document.createElement('p');
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = w;
      pEl.appendChild(span);
      if (i < words.length - 1) pEl.appendChild(document.createTextNode(' '));
      wordEls.push(span);
      scriptWordsNorm.push(normalizeWord(w));
    });
    contentEl.appendChild(pEl);
  });
}

function updateTimecode() {
  timecodeEl.textContent = `${formatTime(prompter.getActiveSeconds())} / ${formatTime(prompter.getTotalSeconds())}`;
}

function openReader(script) {
  currentScript = script;
  sessionLogged = false;
  expectedIndex = 0;
  micUsedThisSession = false;
  sessionCorrectCount = 0;
  sessionMissedWords = [];
  if (micOn) { speech.stop(); setMicState(false); }
  screenSetup.classList.remove('is-active');
  screenReader.classList.add('is-active');
  contentEl.lang = script.lang;
  renderContentText(script.text);
  requestAnimationFrame(() => {
    prompter.reset();
    prompter.setContentMeta(script.wordCount);
    prompter.setWpm(state.wpmSetting);
    wpmReadout.textContent = prompter.getWpm();
    progressFill.style.width = '0%';
    syncPlayButton();
    updateTimecode();
  });
}

function logSession(completed) {
  if (!currentScript || sessionLogged) return;
  const activeSeconds = prompter.getActiveSeconds();
  if (activeSeconds < 2) return;
  sessionLogged = true;
  const wordsTracked = sessionCorrectCount + sessionMissedWords.length;
  addHistoryEntry({
    title: currentScript.title,
    lang: currentScript.lang,
    topic: currentScript.topic,
    targetMinutes: state.duration,
    activeSeconds,
    completed: !!completed,
    micUsed: micUsedThisSession,
    wordsCorrect: sessionCorrectCount,
    wordsTracked,
    missedWords: sessionMissedWords.slice(0, 80),
  });
  renderHistory();
}

function closeReader() {
  prompter.pause();
  if (micOn) { speech.stop(); setMicState(false); }
  logSession(false);
  screenReader.classList.remove('is-active');
  screenSetup.classList.add('is-active');
}

prompter.onTick(({ progress }) => {
  progressFill.style.width = `${Math.round(progress * 100)}%`;
  updateTimecode();
});
prompter.onFinish(() => {
  syncPlayButton();
  progressFill.style.width = '100%';
  updateTimecode();
  if (micOn) { speech.stop(); setMicState(false); }
  logSession(true);
});

btnPlayPause.addEventListener('click', () => {
  prompter.toggle();
  syncPlayButton();
});
btnBack.addEventListener('click', closeReader);

function bumpSpeed(delta) {
  wpmReadout.textContent = prompter.setWpm(prompter.getWpm() + delta);
}
btnSpeedUp.addEventListener('click', () => bumpSpeed(20));
btnSpeedDown.addEventListener('click', () => bumpSpeed(-20));

function bumpFont(delta) {
  fontSize = Math.max(20, Math.min(52, fontSize + delta));
  contentEl.style.fontSize = fontSize + 'px';
}
btnFontUp.addEventListener('click', () => bumpFont(2));
btnFontDown.addEventListener('click', () => bumpFont(-2));

// ---------- arrastar/clicar na barra de progresso, como num vídeo ----------
let scrubbing = false;
let wasPlayingBeforeScrub = false;

function progressFromEvent(e) {
  const rect = progressTrack.getBoundingClientRect();
  const x = e.clientX - rect.left;
  return rect.width ? Math.max(0, Math.min(1, x / rect.width)) : 0;
}

function applySeek(e) {
  const p = progressFromEvent(e);
  prompter.seekToProgress(p);
  progressFill.style.width = `${Math.round(p * 100)}%`;
  updateTimecode();
}

progressTrack.addEventListener('pointerdown', (e) => {
  if (!currentScript) return;
  scrubbing = true;
  wasPlayingBeforeScrub = prompter.isPlaying();
  prompter.pause();
  syncPlayButton();
  progressTrack.classList.add('is-scrubbing');
  progressTrack.setPointerCapture(e.pointerId);
  applySeek(e);
});
progressTrack.addEventListener('pointermove', (e) => {
  if (!scrubbing) return;
  applySeek(e);
});
function endScrub() {
  if (!scrubbing) return;
  scrubbing = false;
  progressTrack.classList.remove('is-scrubbing');
  if (wasPlayingBeforeScrub) {
    prompter.play();
    syncPlayButton();
  }
}
progressTrack.addEventListener('pointerup', endScrub);
progressTrack.addEventListener('pointercancel', endScrub);

// ---------- reconhecimento de voz ----------
function markWord(i, state_) {
  const el = wordEls[i];
  if (!el) return;
  el.classList.remove('w-correct', 'w-missed');
  el.classList.add(state_ === 'correct' ? 'w-correct' : 'w-missed');
  if (state_ === 'correct') sessionCorrectCount++;
  else sessionMissedWords.push(el.textContent);
}

function handleFinalChunk(text) {
  const LOOKAHEAD = 8;
  const spoken = tokenize(text).map(normalizeWord).filter(Boolean);
  spoken.forEach(sw => {
    let found = -1;
    for (let k = 0; k < LOOKAHEAD && expectedIndex + k < scriptWordsNorm.length; k++) {
      if (scriptWordsNorm[expectedIndex + k] === sw) { found = expectedIndex + k; break; }
    }
    if (found >= 0) {
      for (let j = expectedIndex; j < found; j++) markWord(j, 'missed');
      markWord(found, 'correct');
      expectedIndex = found + 1;
    }
    // se não achar no horizonte de busca, ignora — provavelmente foi o
    // reconhecedor entendendo errado, não vale marcar como erro do usuário
  });
}

const speech = createSpeechChecker({
  onFinalChunk: handleFinalChunk,
  onInterim: (text) => { liveCaption.textContent = text; },
  onError: (err) => {
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      liveCaption.textContent = 'Permissão de microfone negada.';
      setMicState(false);
    }
  },
});

function setMicState(on) {
  micOn = on;
  if (on) micUsedThisSession = true;
  btnMic.setAttribute('aria-pressed', on ? 'true' : 'false');
  contentEl.classList.toggle('mic-active', on);
  if (!on) liveCaption.textContent = '';
}

if (!micIsSupported()) {
  btnMic.disabled = true;
  btnMic.title = 'Reconhecimento de voz não é suportado nesse navegador (funciona no Chrome/Edge).';
}

btnMic.addEventListener('click', () => {
  if (!micIsSupported()) return;
  if (micOn) {
    speech.stop();
    setMicState(false);
    return;
  }
  const speechLang = (LANGS[currentScript ? currentScript.lang : state.lang] || {}).speechLang || 'en-US';
  const ok = speech.start(speechLang);
  if (ok) setMicState(true);
});

document.addEventListener('keydown', (e) => {
  if (!screenReader.classList.contains('is-active')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    prompter.toggle();
    btnPlayPause.textContent = prompter.isPlaying() ? '❚❚' : '▶';
  } else if (e.code === 'ArrowUp') {
    e.preventDefault();
    bumpSpeed(20);
  } else if (e.code === 'ArrowDown') {
    e.preventDefault();
    bumpSpeed(-20);
  } else if (e.code === 'Escape') {
    e.preventDefault();
    closeReader();
  }
});

// ---------- inicialização ----------
renderLibrary();
renderHistory();
