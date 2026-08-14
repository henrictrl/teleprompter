import { LANGS, TOPICS, buildScript } from './wikipedia.js';
import { getCache, saveToCache, deleteFromCache, getHistory, addHistoryEntry, getStats, fixMissedWord } from './storage.js';
import { createTeleprompter } from './teleprompter.js';
import { isSupported as micIsSupported, createSpeechChecker, normalizeWord, tokenize } from './speech.js';

// ---------- estado ----------
const state = {
  lang: 'en',
  source: 'wikipedia', // 'wikipedia' | 'custom'
  topic: 'random',
  duration: 2,
  wpmSetting: 130,
};
let currentScript = null;
let sessionLogged = false;
let sessionMinimized = false;
let fontSize = 34;

let wordEls = [];
let scriptWordsNorm = [];
let wordStates = []; // paralelo a wordEls: null | 'correct' | 'missed'
let expectedIndex = 0;
let micOn = false;
let micUsedThisSession = false;

const SILENCE_TIMEOUT_MS = 6000;
let silenceTimer = null;
let lastRecognitionActivity = 0;

// ---------- refs: tela de configuração ----------
const topicSelect = document.getElementById('topic-select');
const wpmRange = document.getElementById('wpm-range');
const wpmValue = document.getElementById('wpm-value');
const btnGenerate = document.getElementById('btn-generate');
const genStatus = document.getElementById('generate-status');
const wikipediaFields = document.getElementById('wikipedia-fields');
const customFields = document.getElementById('custom-fields');
const customText = document.getElementById('custom-text');
const btnUseCustom = document.getElementById('btn-use-custom');
const customStatus = document.getElementById('custom-status');
const libraryList = document.getElementById('library-list');
const libraryEmpty = document.getElementById('library-empty');
const statsSummary = document.getElementById('stats-summary');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const voiceSummary = document.getElementById('voice-summary');
const voiceHistoryList = document.getElementById('voice-history-list');
const voiceHistoryEmpty = document.getElementById('voice-history-empty');

// ---------- refs: player flutuante ----------
const miniPlayer = document.getElementById('mini-player');
const miniPlayerBody = document.getElementById('mini-player-body');
const miniPlayerTitle = document.getElementById('mini-player-title');
const miniPlayerMeta = document.getElementById('mini-player-meta');
const miniPlayerProgressFill = document.getElementById('mini-player-progress-fill');
const miniPlayerClose = document.getElementById('mini-player-close');

// ---------- refs: tela de leitura ----------
const screenSetup = document.getElementById('screen-setup');
const screenReader = document.getElementById('screen-reader');
const viewport = document.getElementById('viewport');
const contentEl = document.getElementById('content');
const readerTitle = document.getElementById('reader-title');
const timecodeEl = document.getElementById('timecode');
const progressFill = document.getElementById('progress-fill');
const btnPlayPause = document.getElementById('btn-playpause');
const wpmReadout = document.getElementById('wpm-readout');
const btnBack = document.getElementById('btn-back');
const btnMinimize = document.getElementById('btn-minimize');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnSpeedUp = document.getElementById('btn-speed-up');
const btnSpeedDown = document.getElementById('btn-speed-down');
const btnFontUp = document.getElementById('btn-font-up');
const btnFontDown = document.getElementById('btn-font-down');
const btnMic = document.getElementById('btn-mic');
const micLabel = document.getElementById('mic-label');
const voiceScore = document.getElementById('voice-score');
const liveCaption = document.getElementById('live-caption');
const voiceHint = document.getElementById('voice-hint');
const progressTrack = document.getElementById('progress-track');

// ---------- refs: popup de correção ----------
const correctionOverlay = document.getElementById('correction-overlay');
const correctionClose = document.getElementById('correction-close');
const correctionWordEl = document.getElementById('correction-word');
const correctionStatus = document.getElementById('correction-status');
const correctionMic = document.getElementById('correction-mic');
const correctionMicLabel = document.getElementById('correction-mic-label');
const correctionCaption = document.getElementById('correction-caption');
const correctionManual = document.getElementById('correction-manual');

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
  if (id === 'custom') return 'Meu texto';
  return (TOPICS.find(t => t.id === id) || {}).label || id;
}

function accuracyTier(pct) {
  if (pct >= 85) return 'good';
  if (pct >= 60) return 'mid';
  return 'low';
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
wireSeg('field-source', v => {
  state.source = v;
  wikipediaFields.hidden = v !== 'wikipedia';
  customFields.hidden = v !== 'custom';
});

topicSelect.addEventListener('change', () => { state.topic = topicSelect.value; });

function updateRangeFill(rangeEl) {
  const min = Number(rangeEl.min);
  const max = Number(rangeEl.max);
  const pct = ((Number(rangeEl.value) - min) / (max - min)) * 100;
  rangeEl.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
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

btnUseCustom.addEventListener('click', () => {
  const raw = customText.value || '';
  const cleaned = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  customStatus.classList.remove('is-error');
  if (wordCount < 5) {
    customStatus.classList.add('is-error');
    customStatus.textContent = 'Cole ou escreva um pouco mais de texto.';
    return;
  }
  customStatus.textContent = '';
  const words = cleaned.split(/\s+/).filter(Boolean);
  const title = words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : '');
  const script = {
    title,
    text: cleaned,
    wordCount,
    lang: state.lang,
    topic: 'custom',
    sources: [],
  };
  saveToCache(script);
  renderLibrary();
  openReader(script);
});

// ---------- painéis recolhíveis ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.card-collapse-btn');
  if (!btn) return;
  const card = btn.closest('.card');
  if (!card) return;
  const collapsed = card.classList.toggle('is-collapsed');
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
});

// ---------- biblioteca ----------
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

// ---------- relatórios ----------
function tallyWords(words) {
  const counts = new Map();
  words.forEach(w => {
    const key = w.toLowerCase();
    if (!counts.has(key)) counts.set(key, { word: w, count: 0 });
    counts.get(key).count++;
  });
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

function chipRow(items, lang) {
  return `<div class="chip-row">${items.map(({ word, count }) =>
    `<button type="button" class="chip" data-word="${escapeHTML(word)}" data-lang="${escapeHTML(lang)}">${escapeHTML(word)}${count > 1 ? `<span class="chip-count">×${count}</span>` : ''}</button>`
  ).join('')}</div>`;
}

function renderTopMissed(stats) {
  const container = document.getElementById('top-missed');
  const langs = Object.keys(stats.topMissedByLang || {}).filter(l => stats.topMissedByLang[l].length);
  if (!langs.length) { container.innerHTML = ''; return; }
  container.innerHTML = langs.map(lang => `
    <div class="top-missed-group">
      <div class="top-missed-label">Palavras que mais escapam — ${LANGS[lang]?.label || lang}</div>
      ${chipRow(stats.topMissedByLang[lang], lang)}
    </div>
  `).join('');
}

function renderReports() {
  const stats = getStats();
  const history = getHistory();

  // ---- histórico de leitura (geral) ----
  statsSummary.innerHTML = `
    <div class="stat-item"><span class="stat-value mono">${stats.totalSessions}</span><span class="stat-label">sessões</span></div>
    <div class="stat-item"><span class="stat-value mono">${stats.totalMinutes}</span><span class="stat-label">min. lidos</span></div>
    <div class="stat-item"><span class="stat-value mono">${stats.completionRate}%</span><span class="stat-label">concluídas</span></div>
  `;
  historyEmpty.style.display = history.length ? 'none' : '';
  historyList.innerHTML = history.slice(0, 8).map(h => {
    const mins = Math.round(((h.activeSeconds || 0) / 60) * 10) / 10;
    const metaParts = [LANGS[h.lang]?.label || h.lang, `${mins} min`];
    if (h.completed) metaParts.push('concluído');
    metaParts.push(formatRelativeDate(h.at));
    return `
      <li class="list-item">
        <div class="list-item-main">
          <div class="list-item-title">${escapeHTML(h.title || 'Texto')}</div>
          <div class="list-item-meta">${metaParts.join(' · ')}</div>
        </div>
      </li>
    `;
  }).join('');

  // ---- reconhecimento de voz (área própria) ----
  const accTier = stats.avgAccuracy === null ? '' : `is-${accuracyTier(stats.avgAccuracy)}`;
  voiceSummary.innerHTML = `
    <div class="stat-item"><span class="stat-value mono ${accTier}">${stats.avgAccuracy === null ? '—' : stats.avgAccuracy + '%'}</span><span class="stat-label">precisão média</span></div>
    <div class="stat-item"><span class="stat-value mono">${stats.micSessionsCount}</span><span class="stat-label">leituras com voz</span></div>
  `;
  renderTopMissed(stats);

  const voiceSessions = history.filter(h => h.micUsed && (h.wordsTracked || 0) > 0);
  voiceHistoryEmpty.style.display = voiceSessions.length ? 'none' : '';
  voiceHistoryList.innerHTML = voiceSessions.slice(0, 8).map(h => {
    const accuracy = Math.round((h.wordsCorrect / h.wordsTracked) * 100);
    const tier = accuracyTier(accuracy);
    const metaParts = [LANGS[h.lang]?.label || h.lang, `<span class="is-${tier}">${accuracy}% reconhecido</span>`, formatRelativeDate(h.at)];

    const missedTally = h.missedWords && h.missedWords.length ? tallyWords(h.missedWords) : [];
    const detail = missedTally.length ? `
      <details class="history-detail">
        <summary>${missedTally.length} palavra${missedTally.length === 1 ? '' : 's'} não reconhecida${missedTally.length === 1 ? '' : 's'}</summary>
        ${chipRow(missedTally, h.lang)}
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

// clique numa palavra errada do relatório (painel de mais erradas ou
// detalhe por sessão) abre o mesmo popup de correção do teleprompter
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip || !chip.dataset.word) return;
  openCorrectionModal({
    word: chip.dataset.word,
    lang: chip.dataset.lang,
    onFixed: () => {
      fixMissedWord(chip.dataset.lang, chip.dataset.word);
      renderReports();
    },
    onClose: () => {},
  });
});

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
      span.dataset.idx = String(wordEls.length);
      pEl.appendChild(span);
      if (i < words.length - 1) pEl.appendChild(document.createTextNode(' '));
      wordEls.push(span);
      scriptWordsNorm.push(normalizeWord(w));
    });
    contentEl.appendChild(pEl);
  });
  wordStates = new Array(wordEls.length).fill(null);
}

function updateTimecode() {
  timecodeEl.textContent = `${formatTime(prompter.getActiveSeconds())} / ${formatTime(prompter.getTotalSeconds())}`;
}

function openReader(script) {
  currentScript = script;
  sessionLogged = false;
  sessionMinimized = false;
  expectedIndex = 0;
  micUsedThisSession = false;
  if (micOn) { speech.stop(); setMicState(false); }
  stopSilenceWatch();
  liveCaption.textContent = '';
  voiceScore.textContent = '';
  voiceScore.className = 'voice-score mono';
  hideMiniPlayer();
  screenSetup.classList.remove('is-active');
  screenReader.classList.add('is-active');
  contentEl.lang = script.lang;
  readerTitle.textContent = script.title || '';
  renderContentText(script.text);
  // Sem requestAnimationFrame aqui de propósito: ler scrollHeight logo
  // abaixo já força o navegador a calcular o layout do texto novo na
  // hora, então dá pra fazer tudo direto, sem brecha de tempo em que
  // a tela já está clicável mas o motor ainda não está pronto.
  prompter.reset();
  prompter.setContentMeta(script.wordCount);
  prompter.setWpm(state.wpmSetting);
  wpmReadout.textContent = prompter.getWpm();
  progressFill.style.width = '0%';
  syncPlayButton();
  updateTimecode();
}

function getSessionStats() {
  let correct = 0;
  const missedWords = [];
  wordStates.forEach((s, i) => {
    if (s === 'correct') correct++;
    else if (s === 'missed') missedWords.push(wordEls[i].textContent);
  });
  return { correct, tracked: correct + missedWords.length, missedWords };
}

function logSession(completed) {
  if (!currentScript || sessionLogged) return;
  const activeSeconds = prompter.getActiveSeconds();
  if (activeSeconds < 2) return;
  sessionLogged = true;
  const { correct, tracked, missedWords } = getSessionStats();
  addHistoryEntry({
    title: currentScript.title,
    lang: currentScript.lang,
    topic: currentScript.topic,
    targetMinutes: state.duration,
    activeSeconds,
    completed: !!completed,
    micUsed: micUsedThisSession,
    wordsCorrect: correct,
    wordsTracked: tracked,
    missedWords: missedWords.slice(0, 80),
  });
  renderReports();
}

function endSessionCommon() {
  closeCorrectionModal();
  prompter.pause();
  if (micOn) { speech.stop(); setMicState(false); }
  stopSilenceWatch();
  syncPlayButton();
}

function closeReader() {
  endSessionCommon();
  logSession(false);
  hideMiniPlayer();
  screenReader.classList.remove('is-active');
  screenSetup.classList.add('is-active');
  currentScript = null;
  sessionMinimized = false;
}

function minimizeReader() {
  endSessionCommon();
  sessionMinimized = true;
  screenReader.classList.remove('is-active');
  screenSetup.classList.add('is-active');
  showMiniPlayer();
}

function restoreReader() {
  if (!sessionMinimized || !currentScript) return;
  sessionMinimized = false;
  hideMiniPlayer();
  screenSetup.classList.remove('is-active');
  screenReader.classList.add('is-active');
  syncPlayButton();
  updateTimecode();
  progressFill.style.width = `${Math.round(prompter.getProgress() * 100)}%`;
}

function showMiniPlayer() {
  if (!currentScript) return;
  miniPlayerTitle.textContent = currentScript.title || 'Texto';
  miniPlayerMeta.textContent = `${LANGS[currentScript.lang]?.label || currentScript.lang} · pausado`;
  miniPlayerProgressFill.style.width = `${Math.round(prompter.getProgress() * 100)}%`;
  miniPlayer.hidden = false;
}
function hideMiniPlayer() {
  miniPlayer.hidden = true;
}

miniPlayerBody.addEventListener('click', restoreReader);
miniPlayerClose.addEventListener('click', (e) => {
  e.stopPropagation();
  closeReader();
});

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
  if (prompter.isPlaying()) {
    prompter.pause();
    if (micOn) { speech.stop(); setMicState(false); }
  } else {
    prompter.play();
  }
  syncPlayButton();
});
btnBack.addEventListener('click', closeReader);
btnMinimize.addEventListener('click', minimizeReader);
btnFullscreen.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

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
  if (progressTrack.setPointerCapture) progressTrack.setPointerCapture(e.pointerId);
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
  wordStates[i] = state_;
  el.classList.remove('w-correct', 'w-missed');
  el.classList.add(state_ === 'correct' ? 'w-correct' : 'w-missed');
}

function updateCurrentWordHighlight() {
  wordEls.forEach(el => el.classList.remove('is-current'));
  const el = wordEls[expectedIndex];
  if (el) el.classList.add('is-current');
}

function clearCurrentWordHighlight() {
  wordEls.forEach(el => el.classList.remove('is-current'));
}

function updateVoiceScore() {
  const { correct, tracked } = getSessionStats();
  if (!tracked) {
    voiceScore.textContent = '';
    voiceScore.className = 'voice-score mono';
    return;
  }
  const pct = Math.round((correct / tracked) * 100);
  voiceScore.textContent = `${correct}/${tracked} · ${pct}%`;
  voiceScore.className = `voice-score mono is-${accuracyTier(pct)}`;
}

function registerRecognitionActivity() {
  lastRecognitionActivity = Date.now();
}

function stopSilenceWatch() {
  if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
}

function startSilenceWatch() {
  stopSilenceWatch();
  registerRecognitionActivity();
  silenceTimer = setInterval(() => {
    if (!micOn) { stopSilenceWatch(); return; }
    if (Date.now() - lastRecognitionActivity > SILENCE_TIMEOUT_MS) {
      // silêncio prolongado: desliga o reconhecimento e o texto
      // continua rolando sozinho, na velocidade escolhida
      speech.stop();
      setMicState(false);
    }
  }, 1000);
}

// Casa as últimas palavras faladas contra uma janela à frente do
// ponteiro atual, pegando qualquer uma delas nessa janela — não
// precisa ser a primeira da vez nem vir na ordem exata, o que deixa
// o reconhecimento acompanhar mesmo quando o app ouve fora de ordem.
const MATCH_LOOKAHEAD = 10;
const RECENT_WORDS = 5;

function processTranscript(text) {
  liveCaption.textContent = text;
  registerRecognitionActivity();

  const tokens = tokenize(text).map(normalizeWord).filter(Boolean);
  if (!tokens.length) return;

  // multiconjunto das últimas palavras ouvidas — cada uma só pode
  // "se gastar" casando com uma posição por vez, pra não casar a
  // mesma palavra falada com duas posições diferentes do roteiro
  const remaining = new Map();
  tokens.slice(-RECENT_WORDS).forEach(t => remaining.set(t, (remaining.get(t) || 0) + 1));

  let advanced = false;
  let guard = 0;
  while (remaining.size && guard < MATCH_LOOKAHEAD) {
    guard++;
    let found = -1;
    for (let k = 0, ptr = expectedIndex; ptr < scriptWordsNorm.length && k < MATCH_LOOKAHEAD; ptr++, k++) {
      const w = scriptWordsNorm[ptr];
      if (w && remaining.has(w)) { found = ptr; break; }
    }
    if (found === -1) break;

    const w = scriptWordsNorm[found];
    const left = remaining.get(w) - 1;
    if (left > 0) remaining.set(w, left);
    else remaining.delete(w);

    for (let j = expectedIndex; j < found; j++) markWord(j, 'missed');
    markWord(found, 'correct');
    expectedIndex = found + 1;
    advanced = true;
  }

  if (advanced) {
    updateCurrentWordHighlight();
    updateVoiceScore();
    if (prompter.getMode() === 'follow') {
      const target = wordEls[Math.min(expectedIndex, wordEls.length - 1)];
      prompter.scrollToWord(target);
    }
  }
}

const speech = createSpeechChecker({
  onTranscript: processTranscript,
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
  micLabel.textContent = on ? 'Ouvindo…' : 'Voz';
  contentEl.classList.toggle('mic-active', on);
  voiceHint.classList.toggle('is-visible', on);
  if (on) {
    updateCurrentWordHighlight();
    prompter.setMode('follow');
    if (!prompter.isPlaying()) { prompter.play(); syncPlayButton(); }
    startSilenceWatch();
  } else {
    liveCaption.textContent = '';
    clearCurrentWordHighlight();
    prompter.setMode('timer');
    stopSilenceWatch();
  }
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

// clicar numa palavra (com o mic ligado) NUNCA marca ela certa na
// hora — sempre abre o popup pra pessoa corrigir falando
contentEl.addEventListener('click', (e) => {
  if (!micOn) return;
  const el = e.target.closest('.word');
  if (!el || !el.dataset.idx) return;
  openWordCorrectionInReader(Number(el.dataset.idx));
});

function openWordCorrectionInReader(i) {
  const el = wordEls[i];
  if (!el || !currentScript) return;
  const word = el.textContent;
  const wasPlaying = prompter.isPlaying();
  const micWasOn = micOn;
  prompter.pause();
  if (micOn) { speech.stop(); setMicState(false); }
  syncPlayButton();

  openCorrectionModal({
    word,
    lang: currentScript.lang,
    onFixed: () => {
      try {
        markWord(i, 'correct');
        updateCurrentWordHighlight();
        updateVoiceScore();
        fixMissedWord(currentScript.lang, word);
        // renderReports é pesado - executar de forma assíncrona
        setTimeout(() => {
          try { renderReports(); } catch (e) { console.error('Error rendering reports:', e); }
        }, 0);
      } catch (e) {
        console.error('Error in onFixed:', e);
      }
    },
    onClose: () => {
      try {
        if (micWasOn) {
          const speechLang = (LANGS[currentScript.lang] || {}).speechLang || 'en-US';
          const ok = speech.start(speechLang);
          if (ok) setMicState(true);
        }
        if (wasPlaying) { prompter.play(); syncPlayButton(); }
      } catch (e) {
        console.error('Error in onClose:', e);
      }
    },
  });
}

// ---------- popup de correção (compartilhado: teleprompter + relatório) ----------
let correctionState = null;
let correctionSpeech = null;

function openCorrectionModal({ word, lang, onFixed, onClose }) {
  if (correctionState && !correctionOverlay.hidden) return;

  stopCorrectionSpeech();
  correctionState = { word, lang, onFixed, onClose, fixed: false };
  correctionWordEl.textContent = word;
  correctionStatus.textContent = 'Toque em "Ouvir" e fale a palavra em voz alta.';
  correctionStatus.className = 'correction-status';
  correctionCaption.textContent = '';
  correctionMic.disabled = !micIsSupported();
  correctionMic.title = micIsSupported() ? '' : 'Reconhecimento de voz não é suportado nesse navegador.';
  correctionMic.setAttribute('aria-pressed', 'false');
  correctionMicLabel.textContent = 'Ouvir';
  correctionManual.disabled = false;
  correctionOverlay.hidden = false;
}

function stopCorrectionSpeech() {
  if (correctionSpeech) {
    try { correctionSpeech.stop(); } catch (e) {}
    correctionSpeech = null;
  }
  try {
    if (correctionMic) correctionMic.setAttribute('aria-pressed', 'false');
    if (correctionMicLabel) correctionMicLabel.textContent = 'Ouvir';
  } catch (e) {}
}

function closeCorrectionModal() {
  const current = correctionState;
  const cb = current && current.onClose;
  stopCorrectionSpeech();
  correctionState = null;
  try { if (correctionOverlay) correctionOverlay.hidden = true; } catch (e) {}
  try { if (cb) cb(); } catch (e) {}
}

function markCorrectionFixed() {
  const current = correctionState;
  if (!current || current.fixed) return;
  current.fixed = true;
  try { stopCorrectionSpeech(); } catch (e) {}

  try {
    if (correctionStatus) correctionStatus.textContent = 'Reconhecido! Palavra corrigida.';
    if (correctionStatus) correctionStatus.className = 'correction-status is-good';
    if (correctionManual) correctionManual.disabled = true;
  } catch (e) {}

  const safeState = current;
  setTimeout(() => {
    try {
      if (correctionState !== safeState) return;
      if (safeState.onFixed) safeState.onFixed();
    } catch (e) { console.error('Error in onFixed:', e); }

    setTimeout(() => {
      if (correctionState === safeState) closeCorrectionModal();
    }, 100);
  }, 500);
}

correctionMic.addEventListener('click', () => {
  try {
    const current = correctionState;
    if (!current || !micIsSupported()) return;
    if (correctionSpeech) { stopCorrectionSpeech(); return; }
    const speechLang = (LANGS[current.lang] || {}).speechLang || 'en-US';
    const targetNorm = normalizeWord(current.word);
    correctionSpeech = createSpeechChecker({
      onTranscript: (text) => {
        try {
          if (correctionState !== current) return;
          if (correctionCaption) correctionCaption.textContent = text;
          const heard = tokenize(text).map(normalizeWord).filter(Boolean);
          if (heard.includes(targetNorm)) markCorrectionFixed();
        } catch (e) {}
      },
      onError: (err) => {
        try {
          if (correctionState !== current) return;
          if (err === 'not-allowed' || err === 'service-not-allowed') {
            if (correctionStatus) correctionStatus.textContent = 'Permissão de microfone negada.';
          }
        } catch (e) {}
      },
    });
    const ok = correctionSpeech.start(speechLang);
    if (ok) {
      if (correctionMic) correctionMic.setAttribute('aria-pressed', 'true');
      if (correctionMicLabel) correctionMicLabel.textContent = 'Ouvindo…';
      if (correctionStatus) correctionStatus.textContent = 'Ouvindo…';
    } else {
      correctionSpeech = null;
    }
  } catch (e) { closeCorrectionModal(); }
});
correctionManual.addEventListener('click', () => {
  try { markCorrectionFixed(); } catch (e) {
    closeCorrectionModal();
  }
});
correctionClose.addEventListener('click', () => {
  try { closeCorrectionModal(); } catch (e) {
    if (correctionOverlay) correctionOverlay.hidden = true;
    correctionState = null;
  }
});
correctionOverlay.addEventListener('click', (e) => {
  try { if (e.target === correctionOverlay) closeCorrectionModal(); } catch (e) {}
});

// ---------- atalhos de teclado ----------
document.addEventListener('keydown', (e) => {
  if (!correctionOverlay.hidden) {
    if (e.code === 'Escape') { e.preventDefault(); closeCorrectionModal(); }
    return;
  }
  if (!screenReader.classList.contains('is-active')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (prompter.isPlaying()) {
      prompter.pause();
      if (micOn) { speech.stop(); setMicState(false); }
    } else {
      prompter.play();
    }
    syncPlayButton();
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
renderReports();
