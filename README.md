# 🐺 GrizzWolfAI

**O lobo ancião da FACOM/UFU.** Como o veterano da alcateia cujo focinho ficou grisalho de tanta experiência, o Grizz guia os calouros pela burocracia da universidade com respostas baseadas nos documentos oficiais. Todo calouro merece um veterano que já leu todas as normas.

O Grizz é um assistente de perguntas e respostas (RAG) sobre as normas da Faculdade de Computação da Universidade Federal de Uberlândia: estágio, TCC, atividades complementares, monitoria, extensão, horários e mais. Cada resposta cita o trecho e o PDF oficial de onde a informação saiu.

> [!NOTE]
> O Grizz não substitui a coordenação do curso nem a secretaria. Ele só responde com base nos documentos que conseguiu ler e avisa quando não encontra a informação.

## Funcionalidades

- **Respostas com fontes:** cada afirmação traz uma citação `[n]` com link para o PDF oficial.
- **Respostas por curso e currículo:** na primeira conversa o Grizz pergunta o curso e o ano de ingresso. Com isso ele identifica o currículo do aluno e não mistura as normas de cursos diferentes. Os cursos atendidos são Ciência da Computação, Sistemas de Informação (Santa Mônica e Monte Carmelo) e Inteligência Artificial.
- **Busca híbrida com rerank:** junta a busca por significado (vetorial) com a busca por palavras-chave. Depois, um modelo de linguagem reordena os trechos por relevância.
- **Base atualizada sozinha:** um robô lê diariamente a aba [Documentos](https://facom.ufu.br/central-de-conteudos/documentos) do site da FACOM e importa o que for novo, inclusive PDFs escaneados, que passam por OCR.
- **Histórico no navegador:** as conversas ficam só no navegador do aluno. O servidor não guarda nada da conversa.
- **Avaliação das respostas:** o aluno pode marcar 👍 ou 👎. Só as respostas avaliadas são guardadas, de forma anônima, para melhorar o Grizz.
- **Tema claro e escuro.**

## Como funciona

```mermaid
flowchart LR
    subgraph importacao ["Importação (diária, GitHub Actions)"]
        A[Site da FACOM] -->|lê a aba Documentos| B[PDFs e páginas]
        B -->|texto ou OCR| C[Trechos por artigo]
        C -->|Gemini| D[(Postgres + pgvector)]
    end

    subgraph pergunta ["Pergunta"]
        E[Aluno] -->|pergunta + histórico + perfil| F[Servidor Express]
        F --> G[Busca vetorial]
        F --> H[Busca por palavras-chave]
        G & H -->|fusão RRF| I[Rerank - Groq]
        I -->|5 melhores trechos| J[Resposta - Groq]
        J -->|resposta com citações| E
    end

    D -.-> G & H
```

1. **Importação:** os documentos são baixados e o texto é extraído. PDFs escaneados passam por OCR. O texto é dividido em trechos que respeitam os artigos das normas ("Art. 1º…"), e cada trecho vira um vetor de 768 dimensões gerado pelo Gemini.
2. **Busca:** a pergunta é procurada de duas formas ao mesmo tempo. A busca vetorial acha trechos de significado parecido, e a busca textual em português, que ignora acentos, acha termos exatos como "Resolução 19/2024". As duas listas são combinadas com *Reciprocal Rank Fusion*.
3. **Rerank:** um modelo da Groq dá uma nota de 0 a 10 para cada trecho, considerando o curso do aluno e a ementa do documento, e descarta os irrelevantes.
4. **Resposta:** o Grizz responde só com base nos trechos escolhidos, citando cada um. Quando a busca vetorial fica indisponível, por exemplo com a cota do Gemini esgotada, a busca continua só com palavras-chave.

## Tecnologias

| Parte | Tecnologia |
|---|---|
| Servidor | Node.js 24, Express 5 |
| Banco | PostgreSQL ([Neon](https://neon.tech)) + [pgvector](https://github.com/pgvector/pgvector) |
| Embeddings | Google Gemini (`gemini-embedding-001`, 768 dimensões) |
| Geração e rerank | [Groq](https://groq.com) (`openai/gpt-oss-120b` e `openai/gpt-oss-20b`) |
| Extração | `pdf-parse`, `cheerio` e `tesseract.js` (OCR) |
| Front | HTML, CSS e JavaScript puros, com `marked` e `DOMPurify` |
| Automação | GitHub Actions |

Todos os serviços usados têm plano gratuito.

## Rodando localmente

### Pré-requisitos

- [Node.js](https://nodejs.org) 24 ou mais recente
- Um banco PostgreSQL com a extensão `pgvector`. O plano gratuito do [Neon](https://neon.tech) já vem com ela.
- Uma chave da API do Gemini, gratuita em [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- Uma chave da API da Groq, gratuita em [console.groq.com/keys](https://console.groq.com/keys)

### Passo a passo

```bash
git clone https://github.com/Tensei-dev/GrizzWolfAI.git
cd GrizzWolfAI
npm install
```

Crie um arquivo `.env` na raiz do projeto:

```env
DATABASE_URL=postgresql://usuario:senha@host/banco?sslmode=verify-full
GEMINI_API_KEY=sua-chave-do-gemini
GROQ_API_KEY=sua-chave-da-groq
```

Crie as tabelas, importe os documentos e suba o servidor:

```bash
npm run migrate       # cria as tabelas
npm run sync:facom    # importa os documentos do site da FACOM (demora; veja a nota abaixo)
npm run dev           # sobe o servidor e reinicia a cada alteração
```

Abra **http://localhost:3000**.

> [!IMPORTANT]
> Abra a página pelo endereço do servidor (`localhost:3000`). Se abrir pelo Live Server do VS Code ou direto pelo arquivo `index.html`, as perguntas não funcionam, porque a página não encontra a API.

> [!TIP]
> A primeira importação é longa e pode esbarrar no limite diário gratuito do Gemini. Se isso acontecer, ela para sozinha com o aviso "cota diária do Gemini esgotada". É só rodar `npm run sync:facom` de novo no dia seguinte: o que já foi importado é pulado.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | URL de conexão com o Postgres. O SSL é definido pelo `sslmode` da própria URL. |
| `GEMINI_API_KEY` | sim | Chave da API do Gemini, usada para gerar os embeddings. |
| `GROQ_API_KEY` | sim | Chave da API da Groq, usada para gerar as respostas e fazer o rerank. |
| `GROQ_MODEL` | não | Modelo das respostas. Padrão: `openai/gpt-oss-120b`. |
| `GROQ_RERANK_MODEL` | não | Modelo do rerank e da leitura do perfil do aluno. Padrão: `openai/gpt-oss-20b`. |
| `EMBED_TEXTS_PER_MINUTE` | não | Limite de trechos enviados ao Gemini por minuto. Padrão: `80`. |
| `PORT` | não | Porta do servidor. Padrão: `3000`. |

> [!NOTE]
> A lista de modelos da Groq muda com frequência. Se um modelo deixar de existir, consulte os disponíveis em `GET https://api.groq.com/openai/v1/models` e defina `GROQ_MODEL` e `GROQ_RERANK_MODEL`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o servidor com `nodemon`, que reinicia a cada alteração. |
| `npm start` | Sobe o servidor, para produção. |
| `npm run migrate` | Aplica as migrations de `db/migrations` que ainda não rodaram. |
| `npm run sync:facom` | Importa os documentos novos da aba Documentos do site da FACOM. |
| `npm run sync:facom -- --dry-run` | Só lista o que seria importado, sem gravar nada. |
| `npm run ingest -- data/sources.json` | Importa documentos de outros sites a partir de uma lista. Veja [Adicionando outros documentos](#adicionando-outros-documentos). |
| `npm run dedupe` | Marca como duplicados os documentos com texto idêntico a outro. Use `-- --dry-run` para só listar. |

## Publicando na Vercel

O projeto já vem configurado para a [Vercel](https://vercel.com), com plano gratuito para projetos não comerciais.

- **Arquivos estáticos:** a página, os estilos e as imagens de `public/` são servidos pelo CDN da Vercel.
- **API:** as rotas `/api/*` rodam como uma função serverless (`api/index.js`), que reaproveita o app do `server.js`.
- **Região:** a função roda em Cleveland (`cle1`), perto do banco no Neon (AWS US East 2, Ohio). Se o seu banco estiver em outra região, troque `regions` no [`vercel.json`](vercel.json).

Para publicar:

1. Entre em [vercel.com](https://vercel.com) com a conta do GitHub e clique em **Add New → Project**.
2. Importe o repositório `GrizzWolfAI`. A configuração vem do `vercel.json`, então não precisa mudar nada na tela de build.
3. Em **Environment Variables**, cadastre `DATABASE_URL`, `GEMINI_API_KEY` e `GROQ_API_KEY`, com os mesmos valores do `.env`.
4. Clique em **Deploy**.

Depois disso, cada push na `main` publica uma nova versão automaticamente. Se mudar uma variável de ambiente, faça um **Redeploy** para ela valer.

## Atualização automática

O workflow [`.github/workflows/sync-facom.yml`](.github/workflows/sync-facom.yml) roda todo dia às 6h (horário de Brasília). Ele aplica as migrations, importa os documentos novos e marca os duplicados. Também dá para rodá-lo na mão pela aba **Actions**, em **Run workflow**.

Para ele funcionar, cadastre em **Settings → Secrets and variables → Actions** os segredos `DATABASE_URL` e `GEMINI_API_KEY`.

### Filtros da importação

Nem tudo o que a FACOM publica interessa aos alunos. Os filtros ficam em `SKIP_TITLES` e `SKIP_FILES`, no arquivo [`services/facomCrawler.js`](services/facomCrawler.js). Hoje ficam de fora arquivos que não são PDF e documentos sobre a vida funcional dos professores, concursos, eleições e eventos.

## Adicionando outros documentos

Documentos de fora da aba da FACOM, como as normas da PROGRAD, entram por uma lista em JSON. O modelo está em [`data/sources.json`](data/sources.json):

```json
{
    "categories": [
        { "slug": "graduacao", "name": "Graduação" }
    ],
    "documents": [
        {
            "source": "https://exemplo.ufu.br/resolucao.pdf",
            "title": "Resolução CONGRAD nº 46/2022",
            "docType": "resolução",
            "issuer": "CONGRAD",
            "number": "46/2022",
            "publishedAt": "2022-03-29",
            "categories": ["graduacao"],
            "replaces": { "issuer": "CONGRAD", "number": "15/2011" }
        }
    ]
}
```

- **`source`:** pode ser uma URL (PDF ou página HTML) ou um caminho local relativo ao arquivo JSON.
- **`replaces`:** é opcional. Marca a norma antiga como revogada, e ela deixa de ser usada nas respostas.

```bash
npm run ingest -- data/sources.json
```

## Estrutura do projeto

```
├── server.js                 # servidor Express e rotas da API
├── api/index.js              # entrada da função serverless na Vercel
├── vercel.json               # configuração do deploy na Vercel
├── db/
│   ├── pool.js               # conexão com o Postgres
│   ├── migrate.js            # executor das migrations
│   └── migrations/           # SQL versionado do banco
├── models/                   # acesso às tabelas (um arquivo por tabela)
├── services/
│   ├── agent.js              # o Grizz: perfil do aluno, busca e resposta
│   ├── search.js             # busca híbrida e fusão RRF
│   ├── reranker.js           # rerank dos trechos com a Groq
│   ├── profile.js            # leitura do curso e ano informados pelo aluno
│   ├── courses.js            # cursos da FACOM e seus currículos
│   ├── llm.js                # cliente da Groq
│   ├── embeddings.js         # cliente do Gemini, com controle de cota
│   ├── extractor.js          # texto de PDFs e páginas HTML
│   ├── ocr.js                # OCR de PDFs escaneados
│   ├── chunker.js            # divisão do texto em trechos por artigo
│   ├── ingestion.js          # importação de um documento
│   └── facomCrawler.js       # leitura da aba Documentos do site da FACOM
├── scripts/                  # comandos de importação e manutenção
├── data/sources.json         # lista de documentos extras para importar
└── public/                   # front: HTML, CSS, JS e imagens
```

## API

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/chat` | Recebe `{ question, history, profile }` e devolve `{ answer, sources, profile, model, question }`. O servidor não guarda nada: o navegador envia as últimas mensagens e o perfil a cada pergunta e guarda o perfil atualizado que recebe de volta. |
| `POST` | `/api/feedback` | Recebe `{ answerId, rating, question, answer, sources, profile, model }` e guarda a avaliação de forma anônima. Cada resposta pode ser avaliada uma vez. |

## Banco de dados

| Tabela | Conteúdo |
|---|---|
| `documents` | Documentos oficiais: título, tipo, número, ementa, link, data e status (`vigente`, `revogado` ou `duplicado`). |
| `chunks` | Trechos de cada documento, com o embedding (`vector(768)`) e o índice de busca textual (`tsvector`). |
| `categories` e `document_categories` | Categorias dos documentos. |
| `feedback` | Respostas avaliadas pelos alunos, sem identificação. |

## Limitações conhecidas

- **Cobertura:** o Grizz só conhece o que foi importado. Normas da PROGRAD (matrícula, trancamento, calendário) ainda não entram automaticamente e precisam ser adicionadas pelo `npm run ingest`.
- **Tabela de currículos:** a relação entre ano de ingresso e currículo, em [`services/courses.js`](services/courses.js), foi montada a partir dos títulos dos projetos pedagógicos. Vale confirmar com as coordenações.
- **Perguntas de continuação:** a busca usa só a pergunta atual. Continuações muito curtas, como "e o prazo?", podem buscar pior.
- **Histórico:** fica só no navegador. Ele não sincroniza entre dispositivos e some se os dados do navegador forem limpos.

## Licença

Distribuído sob a licença ISC. Veja o arquivo [LICENSE](LICENSE).

---

Feito pela Liga Acadêmica DataLab - UFU · As respostas se baseiam nos documentos oficiais da UFU.
