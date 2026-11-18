# Guia de estudos do GrizzWolfAI

Manual técnico do repositório em pranchas de arquitetura, com notas pessoais e perguntas ao Claude sobre o código.
O manual e o servidor estão no repositório; ficam fora do git só a sua chave (`.env`), as suas notas (`dados/`) e o `node_modules/`.

## Como abrir

```bash
cd docs
npm install          # só na primeira vez
cp .env.example .env # e coloque a sua ANTHROPIC_API_KEY
npm start
```

Abra **http://localhost:4100**. O servidor só aceita conexões da própria máquina.

## O que tem aqui

| Arquivo | Para quê |
|---|---|
| `server.js` | Serve o manual, guarda as notas e conversa com o Claude. |
| `public/index.html` | As 14 pranchas do manual, com os desenhos em SVG. |
| `public/estilo.css` | O papel azul quadriculado. |
| `public/app.js` | Índice, notas presas aos parágrafos, conversa com o Claude, caderno. |
| `dados/notas.json` | Suas notas. Faça backup se forem importantes. |

## Como o Claude lê o repositório

A cada pergunta, o servidor junta todos os arquivos versionados no git (menos imagens, o `package-lock.json`, o pacote OKF em
`conhecimento/`, que é dado e não código, e este manual, que já vai como a prancha aberta),
numera as linhas e envia como contexto, com cache de prompt de 1 hora. A primeira pergunta paga o contexto
inteiro (~60 mil tokens); as seguintes, dentro de uma hora e sem mudança no código, leem do cache por uma fração do preço.
O nome da prancha e o trecho selecionado vão junto com a pergunta.

Padrões: modelo `claude-opus-5-5`, esforço `medium`, raciocínio adaptativo e fallback automático de modelo
em caso de recusa (`fallbacks: "default"`). Troque o modelo e o esforço em `.env`.
