# Teleprompter

Teleprompter pessoal pra treinar leitura em voz alta em português, inglês
e espanhol. Site estático, sem servidor — roda 100% no navegador.

## Como funciona

### Texto
- **Wikipédia:** busca o resumo inicial de artigos (aleatório ou por
  tema), direto do navegador, via `https://{pt|en|es}.wikipedia.org/w/api.php`
  (API pública, sem chave). Só usa o resumo (não o corpo inteiro do
  artigo) porque é escrito como texto corrido de verdade, sem seções de
  referência nem glosas em outro alfabeto. O texto passa por uma limpeza
  (remove parênteses com fonética/idioma estrangeiro, cabeçalhos
  residuais, marcadores de citação) e por um filtro que evita frases
  muito carregadas de data/número, preferindo sempre o trecho mais fácil
  de ler em voz alta.
- **Seu próprio texto:** dá pra colar ou escrever qualquer texto e usar
  ele no teleprompter — fica salvo na biblioteca junto com os gerados
  pela Wikipédia.

### Leitura
A barra de progresso funciona como a de vídeo: clica ou arrasta pra
pular pra qualquer ponto. A velocidade (ppm) é só uma **referência** —
ela não trava a leitura:

- **Sem o microfone ligado:** rolagem automática numa velocidade
  constante, baseada no ppm escolhido — o modo clássico de
  teleprompter.
- **Com o microfone ligado:** a tela acompanha sua fala de verdade —
  rola até a posição real da palavra reconhecida, não numa velocidade
  fixa. Se você voltar numa frase ou repetir uma palavra, o cronômetro
  não briga com você: ele só registra quanto tempo a sessão levou de
  verdade, pra comparar depois com a duração de referência.
- **Silêncio prolongado com o microfone ligado:** depois de alguns
  segundos sem reconhecer nada, o app desliga o microfone sozinho e
  volta pro modo automático, na velocidade escolhida — sem travar a
  leitura esperando você falar.

### Reconhecimento de voz
O casamento de palavras faladas com o roteiro usa uma janela de
tolerância: qualquer uma das últimas palavras reconhecidas pode casar
com qualquer posição próxima à esperada, não precisa vir na ordem
exata nem no momento exato — isso deixa o acompanhamento muito mais
rápido e mais tolerante a pequenas variações do reconhecedor do que
uma comparação estritamente sequencial.

**Corrigir uma palavra:** clicar numa palavra (dentro do teleprompter,
com o microfone ligado, ou num "chip" de palavra errada no relatório da
tela inicial) abre uma janelinha pra você falar ela até acertar — ou
marcar como corrigida na mão. A leitura pausa enquanto a janelinha está
aberta e retoma sozinha (com o microfone de volta, se estava ligado)
assim que você fecha. A correção vale pra sempre: a palavra sai da
lista de erros em **todas** as sessões salvas, não só na atual.

### Painéis
Cada bloco da tela inicial (textos salvos, reconhecimento de voz,
histórico) pode ser recolhido clicando na setinha do cabeçalho. Em
telas largas, os blocos se organizam em painéis lado a lado (textos
salvos e reconhecimento de voz numa coluna, histórico em outra) —
sem precisar rolar a página pra ver tudo.

### Sessão minimizada
Dentro do teleprompter, a barra de título tem três botões: vermelho
encerra a sessão de vez (salva no histórico), amarelo minimiza — volta
pra tela inicial com um player flutuante mostrando o progresso, pausado
— e verde entra em tela cheia de verdade. Clicar no player flutuante
volta pro teleprompter de onde parou; o X dele encerra a sessão.

### Relatórios e cache
Tudo fica salvo no `localStorage` do navegador — textos gerados ou
colados, e o histórico de sessões, dividido em dois relatórios: um
geral (sessões, minutos lidos, concluídas) e um só de reconhecimento de
voz (precisão média, palavras que mais escapam por idioma, detalhe por
sessão). Nada é enviado pra nenhum servidor — a única exceção é o áudio
do microfone, que o navegador manda pro serviço de reconhecimento de
fala dele (no Chrome, servidores do Google).

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
- `↑` / `↓` — aumenta / diminui a velocidade de referência
- `Esc` — fecha a janelinha de correção se estiver aberta; senão,
  encerra a sessão

## Limitações conhecidas

- **Filtro de tema é aproximado.** Usa busca por palavra-chave (não
  categoria exata da Wikipédia, que é inconsistente entre idiomas e
  quase sempre volta vazia). Se um tema não trouxer resultado
  suficiente, cai automaticamente pro aleatório e avisa na tela.
- **Reconhecimento de voz não é uma nota fonética.** O navegador
  transcreve o que ele "entendeu" que você falou e compara com o
  texto — é um bom indicador prático de inteligibilidade, mas não
  mede sotaque de verdade. Funciona bem no Chrome/Edge; não tem
  suporte no Firefox e é parcial no Safari.
- **Áudio do microfone sai do dispositivo.** No Chrome, o
  reconhecimento roda na nuvem do Google — não é local.

## Próximos passos (ideias, ainda não implementadas)

- Nota final de leitura (histórico de precisão ao longo do tempo em
  gráfico, não só número).
- Persistir o estado recolhido/expandido dos painéis entre sessões.
