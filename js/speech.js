// Usa a Web Speech API nativa do navegador — sem lib externa, sem chave.
// Suporte real hoje: bom no Chrome/Edge, ausente no Firefox, parcial no Safari.
// O áudio é processado na nuvem do navegador (ex.: Google, no Chrome).
//
// Um único retorno de transcrição por evento (não separa mais
// provisório/final) — processa tudo que o reconhecedor entrega, o
// quanto antes, e deixa quem chama decidir o que fazer com isso.
// É o que dá a resposta rápida: não espera a frase "fechar" pra reagir.

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

export function isSupported() {
  return !!SpeechRecognitionCtor;
}

export function createSpeechChecker({ onTranscript, onError } = {}) {
  let recognition = null;
  let shouldListen = false;
  let generation = 0;

  function stop() {
    shouldListen = false;
    generation += 1;

    const current = recognition;
    recognition = null;
    if (!current) return;

    current.onresult = null;
    current.onerror = null;
    current.onend = null;

    try { current.stop(); } catch (e) { /* ignore */ }
  }

  function start(lang) {
    if (!SpeechRecognitionCtor) return false;

    const localGeneration = generation;
    stop();

    recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      if (!shouldListen) return;
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        transcript += (result[0] && result[0].transcript) || '';
      }
      transcript = transcript.trim();
      if (transcript && onTranscript) onTranscript(transcript);
    };

    recognition.onerror = (event) => {
      if (!shouldListen) return;
      if (onError) onError(event.error);
    };

    // O navegador encerra sozinho depois de um tempo de silêncio —
    // se o usuário ainda não pausou o microfone, reinicia na hora.
    recognition.onend = () => {
      if (!shouldListen || generation !== localGeneration) return;
      try { recognition.start(); } catch (e) { /* já estava rodando */ }
    };

    shouldListen = true;
    try {
      recognition.start();
      return true;
    } catch (e) {
      shouldListen = false;
      return false;
    }
  }

  return { start, stop };
}

export function normalizeWord(word) {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}
