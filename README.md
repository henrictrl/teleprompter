# Teleprompter

Teleprompter pessoal pra treinar leitura em voz alta em inglês e espanhol.
Site estático, sem servidor — roda 100% no navegador.

## Como funciona

- **Texto:** busca artigos da Wikipédia (aleatório ou por tema) direto do
  navegador, via `https://{en|es}.wikipedia.org/w/api.php` (API pública,
  sem chave, com CORS liberado por `origin=*`).
- **Tamanho:** você escolhe a duração em minutos; o site converte isso em
  número de palavras (duração × ppm) e junta/corta artigos até chegar
  perto desse tamanho, sempre tentando parar no fim de uma frase.
- **Leitura:** rolagem automática calculada pra terminar no tempo certo,
  com play/pause e velocidade ajustável ao vivo (60 a 600 palavras por
  minuto). A barra de progresso funciona como a de vídeo: clica ou
  arrasta pra pular pra qualquer ponto do texto.
- **Reconhecimento de voz, numa área própria:** dentro do teleprompter,
  a faixa de voz fica separada dos controles de leitura, com placar ao
  vivo (acertos/total e %) e legenda do que foi ouvido. A palavra que
  você deveria estar lendo agora pisca em amarelo — a palavra atual
  correta acende verde ao ser confirmada, a que passou sem confirmar
  fica vermelha e riscada. A luz amarela da barra de título funciona
  como indicador passivo de "microfone ouvindo", junto do botão "Voz".
- **Visual inspirado no macOS:** cartões em vidro fosco (blur +
  translucidez), fonte do sistema (renderiza a San Francisco de
  verdade em Mac), controles segmentados nativos, e uma barra de
  título de verdade no teleprompter — vermelho fecha, verde abre em
  tela cheia (Fullscreen API), amarelo é o indicador de voz.
- **Cache e histórico, em dois relatórios separados:** um card
  "Histórico" com o geral (sessões, minutos, concluídas) e um card
  "Reconhecimento de voz" à parte — precisão média, quantas leituras
  usaram o microfone, um painel de "palavras que mais escapam" por
  idioma (juntando todas as sessões), e por sessão individual, um "+"
  escondido com a lista de palavras não reconhecidas daquela leitura.
  Números coloridos por faixa: verde ≥85%, amarelo 60–84%, vermelho
  abaixo disso. Tudo fica no `localStorage` do navegador — nada é
  enviado pra nenhum servidor (a única exceção é o áudio do microfone,
  que o navegador manda pro serviço de reconhecimento de fala dele —
  no Chrome, servidores do Google).

## Rodar localmente

Não precisa de build. Só precisa servir os arquivos (não abrir o
`index.html` direto com `file://`, porque módulos JS e a busca na
Wikipédia exigem `http://`):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Publicar no GitHub Pages

1. Sobe essa pasta pra um repositório no GitHub.
2. Vai em **Settings → Pages**.
3. Em "Build and deployment", escolhe **Deploy from a branch**, branch
   `main` (ou a que você usar), pasta `/root`.
4. Espera o link ficar pronto (`https://seu-usuario.github.io/repo/`).

## Atalhos de teclado (na tela de leitura)

- `Espaço` — play / pause
- `↑` / `↓` — aumenta / diminui a velocidade
- `Esc` — volta pra tela inicial

## Limitações conhecidas

- **Filtro de tema é aproximado.** A busca usa `incategory:"Nome"` na
  Wikipédia, que só pega páginas categorizadas *diretamente* naquela
  categoria (não desce em subcategorias). Alguns temas podem trazer
  poucos resultados dependendo do idioma — nesse caso o site cai
  automaticamente pro modo aleatório e avisa na tela.
- **Não é "notícia" no sentido jornalístico** — é conteúdo real da
  Wikipédia, mas não factual do dia. Se um dia você quiser notícia de
  verdade, dá pra trocar a fonte por uma API tipo GNews/NewsAPI (exige
  chave gratuita, que num site estático fica visível no código — ok
  pra uso pessoal, mas vale saber).
- **A checagem de pronúncia não é uma nota fonética.** O navegador
  transcreve o que ele "entendeu" que você falou e compara com o texto —
  é um bom indicador prático de inteligibilidade, mas não mede sotaque
  de verdade. Funciona bem no Chrome/Edge; não tem suporte no Firefox
  e é parcial no Safari.

## Próximos passos (ideias, ainda não implementadas)

- Sincronizar a velocidade de rolagem com o ritmo real da fala captada
  pelo microfone, em vez de manter os dois independentes.
- Nota final de leitura (taxa de acerto) ao terminar o texto, além do
  destaque em tempo real.
