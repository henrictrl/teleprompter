// Tudo fica salvo no localStorage do navegador — nada sai da sua máquina.

const CACHE_KEY = 'tp_cache_v1';
const HISTORY_KEY = 'tp_history_v1';
const MAX_CACHE = 40;
const MAX_HISTORY = 200;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Não foi possível salvar (armazenamento cheio ou indisponível).', e);
    return false;
  }
}

export function getCache() {
  return loadJSON(CACHE_KEY, []);
}

export function saveToCache(script) {
  const cache = getCache();
  const entry = {
    id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: script.title,
    text: script.text,
    wordCount: script.wordCount,
    lang: script.lang,
    topic: script.topic,
    sources: script.sources,
    createdAt: new Date().toISOString(),
  };
  cache.unshift(entry);
  if (cache.length > MAX_CACHE) cache.length = MAX_CACHE;
  saveJSON(CACHE_KEY, cache);
  return entry;
}

export function deleteFromCache(id) {
  saveJSON(CACHE_KEY, getCache().filter(e => e.id !== id));
}

export function getHistory() {
  return loadJSON(HISTORY_KEY, []);
}

export function addHistoryEntry(entry) {
  const history = getHistory();
  history.unshift({
    id: 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    ...entry,
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  saveJSON(HISTORY_KEY, history);
}

export function getStats() {
  const history = getHistory();
  const totalSessions = history.length;
  const totalSeconds = history.reduce((sum, h) => sum + (h.activeSeconds || 0), 0);
  const completed = history.filter(h => h.completed).length;
  const byLang = {};
  history.forEach(h => { byLang[h.lang] = (byLang[h.lang] || 0) + 1; });

  return {
    totalSessions,
    totalMinutes: Math.round(totalSeconds / 60),
    completionRate: totalSessions ? Math.round((completed / totalSessions) * 100) : 0,
    byLang,
  };
}
