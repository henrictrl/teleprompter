// Busca textos na Wikipédia (aleatório ou por tema) e monta um roteiro
// com o tamanho aproximado (em palavras) pedido pelo usuário.

export const LANGS = {
  en: { code: 'en', label: 'English', speechLang: 'en-US' },
  es: { code: 'es', label: 'Español', speechLang: 'es-ES' },
};

// Categorias de topo por idioma. É uma aproximação: a busca por
// "incategory" só pega páginas categorizadas diretamente ali (sem
// descer em subcategorias), então alguns temas podem trazer poucos
// resultados dependendo do idioma — nesse caso caímos pra aleatório.
export const TOPICS = [
  { id: 'random',     label: 'Aleatório',        category: null },
  { id: 'science',    label: 'Ciência',          category: { en: 'Science',    es: 'Ciencia' } },
  { id: 'technology', label: 'Tecnologia',       category: { en: 'Technology', es: 'Tecnología' } },
  { id: 'sports',     label: 'Esportes',         category: { en: 'Sports',     es: 'Deporte' } },
  { id: 'history',    label: 'História',         category: { en: 'History',   es: 'Historia' } },
  { id: 'politics',   label: 'Política',         category: { en: 'Politics',  es: 'Política' } },
  { id: 'arts',       label: 'Arte e cultura',   category: { en: 'Arts',      es: 'Arte' } },
  { id: 'geography',  label: 'Geografia',        category: { en: 'Geography', es: 'Geografía' } },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function countWords(text) {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function pageUrl(langCode, title) {
  return `https://${langCode}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

async function fetchCandidates(langCode, topicId, count) {
  const topic = TOPICS.find(t => t.id === topicId) || TOPICS[0];
  const base = `https://${langCode}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'extracts',
    explaintext: '1',
    exlimit: 'max',
    exchars: '6000',
  });

  if (!topic.category) {
    params.set('generator', 'random');
    params.set('grnnamespace', '0');
    params.set('grnlimit', String(count));
  } else {
    const categoryName = topic.category[langCode] || topic.category.en;
    params.set('generator', 'search');
    params.set('gsrnamespace', '0');
    params.set('gsrlimit', String(count));
    params.set('gsrsearch', `incategory:"${categoryName}"`);
  }

  const res = await fetch(`${base}?${params.toString()}`);
  if (!res.ok) throw new Error('Falha ao consultar a Wikipédia.');
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return [];

  return Object.values(pages)
    .filter(p => p.extract && countWords(p.extract) >= 40)
    .map(p => ({
      title: p.title,
      extract: p.extract.trim(),
      url: pageUrl(langCode, p.title),
    }));
}

function trimToWordCount(text, targetWords) {
  // Quebra em "sentenças" de forma simples e vai acumulando até
  // chegar perto do alvo, sempre parando no fim de uma frase.
  const cleaned = text.replace(/\n{2,}/g, '\n\n');
  const sentences = cleaned.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ0-9¡¿"“(])/);

  let out = '';
  let words = 0;
  for (const s of sentences) {
    const w = countWords(s);
    if (words > 0 && words + w > targetWords * 1.15) break;
    out += (out ? ' ' : '') + s.trim();
    words += w;
    if (words >= targetWords) break;
  }

  // Se a divisão por frases não achou fronteiras boas (texto virou
  // um bloco só, ou passou muito do alvo), corta direto por palavra
  // como reserva — melhor um corte no meio da frase do que um texto
  // bem maior do que o tempo escolhido.
  if (words > targetWords * 1.3) {
    const allWords = cleaned.trim().split(/\s+/).filter(Boolean);
    out = allWords.slice(0, targetWords).join(' ');
    words = countWords(out);
  }

  return { text: out || cleaned, wordCount: countWords(out || cleaned) };
}

/**
 * Monta um roteiro de leitura com aproximadamente targetWords palavras,
 * combinando um ou mais artigos até chegar perto do tamanho pedido.
 */
export async function buildScript(langCode, topicId, targetWords) {
  const usedTitles = new Set();
  const parts = [];
  let totalWords = 0;
  let usedFallback = false;
  let attempts = 0;
  let effectiveTopic = topicId;

  while (totalWords < targetWords * 0.9 && attempts < 6) {
    attempts++;
    let candidates = await fetchCandidates(langCode, effectiveTopic, 10);
    candidates = shuffle(candidates).filter(c => !usedTitles.has(c.title));

    if (candidates.length === 0) {
      if (effectiveTopic !== 'random') {
        // Tema não trouxe (mais) resultados nesse idioma: cai pro aleatório.
        effectiveTopic = 'random';
        usedFallback = true;
        continue;
      }
      break;
    }

    const pick = candidates[0];
    usedTitles.add(pick.title);
    parts.push(pick);
    totalWords += countWords(pick.extract);
  }

  if (parts.length === 0) {
    throw new Error('Não encontrei texto nenhum. Tenta de novo em alguns segundos.');
  }

  const combined = parts.map(p => p.extract).join('\n\n');
  const { text, wordCount } = trimToWordCount(combined, targetWords);

  return {
    title: parts[0].title,
    sources: parts.map(p => ({ title: p.title, url: p.url })),
    text,
    wordCount,
    lang: langCode,
    topic: topicId,
    usedFallback,
  };
}
