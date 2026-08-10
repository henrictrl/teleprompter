import { LANGS, TOPICS, buildScript } from './wikipedia.js';
import { getCache, saveToCache, deleteFromCache, getHistory, addHistoryEntry, getStats } from './storage.js';
import { createTeleprompter } from './teleprompter.js';

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

const prompter = createTeleprompter({ viewport, content: contentEl });

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

wpmRange.addEventListener('input', () => {
  state.wpmSetting = parseInt(wpmRange.value, 10);
  wpmValue.textContent = state.wpmSetting;
});

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

function renderHistory() {
  const stats = getStats();
  statsSummary.innerHTML = `
    <div class="stat-item"><span class="stat-value mono">${stats.totalSessions}</span><span class="stat-label">sessões</span></div>
    <div class="stat-item"><span class="stat-value mono">${stats.totalMinutes}</span><span class="stat-label">min. lidos</span></div>
    <div class="stat-item"><span class="stat-value mono">${stats.completionRate}%</span><span class="stat-label">concluídas</span></div>
  `;
  const history = getHistory();
  historyEmpty.style.display = history.length ? 'none' : '';
  historyList.innerHTML = history.slice(0, 8).map(h => {
    const mins = Math.round(((h.activeSeconds || 0) / 60) * 10) / 10;
    return `
      <li class="list-item">
        <div class="list-item-main">
          <div class="list-item-title">${escapeHTML(h.title || 'Texto')}</div>
          <div class="list-item-meta">${LANGS[h.lang]?.label || h.lang} · ${mins} min${h.completed ? ' · concluído' : ''} · ${formatRelativeDate(h.at)}</div>
        </div>
      </li>
    `;
  }).join('');
}

// ---------- tela de leitura ----------
function renderContentText(text) {
  contentEl.style.fontSize = fontSize + 'px';
  contentEl.innerHTML = '';
  text.split(/\n{2,}/).filter(Boolean).forEach(p => {
    const pEl = document.createElement('p');
    pEl.textContent = p.trim();
    contentEl.appendChild(pEl);
  });
}

function updateTimecode() {
  timecodeEl.textContent = `${formatTime(prompter.getActiveSeconds())} / ${formatTime(prompter.getTotalSeconds())}`;
}

function openReader(script) {
  currentScript = script;
  sessionLogged = false;
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
    btnPlayPause.textContent = '▶';
    updateTimecode();
  });
}

function logSession(completed) {
  if (!currentScript || sessionLogged) return;
  const activeSeconds = prompter.getActiveSeconds();
  if (activeSeconds < 2) return;
  sessionLogged = true;
  addHistoryEntry({
    title: currentScript.title,
    lang: currentScript.lang,
    topic: currentScript.topic,
    targetMinutes: state.duration,
    activeSeconds,
    completed: !!completed,
  });
  renderHistory();
}

function closeReader() {
  prompter.pause();
  logSession(false);
  screenReader.classList.remove('is-active');
  screenSetup.classList.add('is-active');
}

prompter.onTick(({ progress }) => {
  progressFill.style.width = `${Math.round(progress * 100)}%`;
  updateTimecode();
});
prompter.onFinish(() => {
  btnPlayPause.textContent = '▶';
  progressFill.style.width = '100%';
  updateTimecode();
  logSession(true);
});

btnPlayPause.addEventListener('click', () => {
  prompter.toggle();
  btnPlayPause.textContent = prompter.isPlaying() ? '❚❚' : '▶';
});
btnBack.addEventListener('click', closeReader);

function bumpSpeed(delta) {
  wpmReadout.textContent = prompter.setWpm(prompter.getWpm() + delta);
}
btnSpeedUp.addEventListener('click', () => bumpSpeed(5));
btnSpeedDown.addEventListener('click', () => bumpSpeed(-5));

function bumpFont(delta) {
  fontSize = Math.max(20, Math.min(52, fontSize + delta));
  contentEl.style.fontSize = fontSize + 'px';
}
btnFontUp.addEventListener('click', () => bumpFont(2));
btnFontDown.addEventListener('click', () => bumpFont(-2));

document.addEventListener('keydown', (e) => {
  if (!screenReader.classList.contains('is-active')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    prompter.toggle();
    btnPlayPause.textContent = prompter.isPlaying() ? '❚❚' : '▶';
  } else if (e.code === 'ArrowUp') {
    e.preventDefault();
    bumpSpeed(5);
  } else if (e.code === 'ArrowDown') {
    e.preventDefault();
    bumpSpeed(-5);
  } else if (e.code === 'Escape') {
    e.preventDefault();
    closeReader();
  }
});

// ---------- inicialização ----------
renderLibrary();
renderHistory();
