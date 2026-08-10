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
  com play/pause e velocidade ajustável ao vivo.
- **Cache e histórico:** tudo fica salvo no `localStorage` do navegador —
  textos gerados (pra reler depois) e o histórico de sessões (pra ver
  estatística de uso). Nada é enviado pra nenhum servidor.

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

## Próximos passos (ainda não implementado)

- **Checagem de pronúncia:** usar a Web Speech API do navegador pra
  ouvir você lendo e destacar o que bateu ou não com o texto. Já foi
  desenhado e é viável (funciona bem no Chrome/Edge, não tem suporte
  no Firefox), só ficou de fora dessa primeira versão pra focar no
  essencial primeiro.
