// Busca textos na Wikipédia (aleatório ou por tema) e monta um roteiro
// com o tamanho aproximado (em palavras) pedido pelo usuário.
//
// Só usa o RESUMO inicial de cada artigo (exintro=1), não o corpo
// inteiro — o corpo completo vem cheio de seções de referências,
// bibliografia e glosas em outras línguas/alfabetos, que é exatamente
// o tipo de coisa ruim de ler em voz alta. O resumo inicial é escrito
// como texto corrido, com começo, meio e fim.

export const LANGS = {
  en: { code: 'en', label: 'English', speechLang: 'en-US' },
  es: { code: 'es', label: 'Español', speechLang: 'es-ES' },
};

// Termos de busca por tema (não usa categoria da Wikipédia — a árvore
// de categorias é inconsistente entre idiomas e a busca por categoria
// direta quase sempre volta vazia. Busca por palavra-chave é muito
// mais confiável.)
export const TOPICS = [
  { id: 'random',     label: 'Aleatório',        query: null },
  { id: 'science',    label: 'Ciência',          query: { en: 'science',             es: 'ciencia' } },
  { id: 'technology', label: 'Tecnologia',       query: { en: 'technology',          es: 'tecnología' } },
  { id: 'sports',     label: 'Esportes',         query: { en: 'sport',               es: 'deporte' } },
  { id: 'history',    label: 'História',         query: { en: 'history',             es: 'historia' } },
  { id: 'politics',   label: 'Política',         query: { en: 'politics government', es: 'política gobierno' } },
  { id: 'arts',       label: 'Arte e cultura',   query: { en: 'art culture',         es: 'arte cultura' } },
  { id: 'geography',  label: 'Geografia',        query: { en: 'geography',           es: 'geografía' } },
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

// Limpa o texto: tira parênteses com alfabeto/fonética estrangeira
// (ex.: "Tóquio (東京, Tōkyō)"), cabeçalhos de seção que sobrarem,
// marcadores de citação tipo [1], e normaliza espaçamento.
function cleanExtract(text) {
  let t = text;

  // parênteses no formato "(Idioma: termo)" — glosa em outro idioma
  // que usa o mesmo alfabeto, então o filtro de caractere abaixo não
  // pegaria sozinho
  t = t.replace(/\s?\((?:German|French|Italian|Portuguese|Latin|Russian|Arabic|Hebrew|Chinese|Japanese|Korean|Greek|Dutch|Polish|Turkish|Hindi|Swedish|Norwegian|Danish|alemán|francés|italiano|portugués|latín|ruso|árabe|hebreo|chino|japonés|coreano|griego|neerlandés|polaco|turco|hindi|sueco|noruego|danés)\s*:[^()]*\)/gi, '');

  // parênteses contendo caractere fora do latino básico/estendido
  // (pega grego, cirílico, hebraico, árabe, CJK, hangul, IPA, marcas
  // de tom — mas preserva acentos comuns de espanhol/português, que
  // ficam bem abaixo dessa faixa)
  t = t.replace(/\s?\([^()]*[\u0250-\uFFFF][^()]*\)/g, '');
  // parênteses vazios ou só com pontuação que sobraram da limpeza acima
  t = t.replace(/\s?\([\s,;:–—-]*\)/g, '');

  // cabeçalhos de seção residuais ("== Ver também ==")
  t = t.replace(/^=+\s*.*?\s*=+$/gm, '');
  // marcadores de citação
  t = t.replace(/\[\d+\]/g, '');
  // espaço antes de pontuação que sobrou de alguma remoção
  t = t.replace(/\s+([.,;:!?])/g, '$1');

  // normaliza espaçamento
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/ *\n */g, '\n');
  t = t.replace(/\n{2,}/g, '\n\n');
  return t.trim();
}

const DISAMBIG_RE = /^[A-ZÁÉÍÓÚÑ][\wÀ-ÿ' -]* (may refer to|puede referirse a|puede hacer referencia a)/i;

async function fetchCandidates(langCode, topicId, count) {
  const topic = TOPICS.find(t => t.id === topicId) || TOPICS[0];
  const base = `https://${langCode}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'extracts',
    explaintext: '1',
    exintro: '1',
    exlimit: 'max',
  });

  if (!topic.query) {
    params.set('generator', 'random');
    params.set('grnnamespace', '0');
    params.set('grnlimit', String(count));
  } else {
    const q = topic.query[langCode] || topic.query.en;
    params.set('generator', 'search');
    params.set('gsrnamespace', '0');
    params.set('gsrlimit', String(count));
    params.set('gsrsearch', q);
    params.set('gsrsort', 'relevance');
  }

  const res = await fetch(`${base}?${params.toString()}`);
  if (!res.ok) throw new Error('Falha ao consultar a Wikipédia.');
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return [];

  return Object.values(pages)
    .filter(p => p.extract)
    .map(p => ({ title: p.title, extract: cleanExtract(p.extract), url: pageUrl(langCode, p.title) }))
    .filter(p => countWords(p.extract) >= 35 && !DISAMBIG_RE.test(p.extract));
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
 * concatenando um ou mais resumos de artigos até chegar perto do
 * tamanho pedido. Cada resumo é um texto corrido completo (começo,
 * meio e fim), então mesmo um roteiro com vários deles lê como uma
 * sequência de trechos completos, não um corte no meio de um artigo.
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
    let candidates = await fetchCandidates(langCode, effectiveTopic, 15);
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
