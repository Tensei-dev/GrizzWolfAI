# 🐺 GrizzWolfAI

**O lobo ancião da FACOM e do IME/UFU.** Como o veterano da alcateia cujo focinho ficou grisalho de tanta experiência, o Grizz guia os calouros pela burocracia da universidade com respostas baseadas nos documentos oficiais. Todo calouro merece um veterano que já leu todas as normas.

O Grizz é um assistente de perguntas e respostas (RAG) sobre as normas da Faculdade de Computação (FACOM) e do Instituto de Matemática e Estatística (IME) da Universidade Federal de Uberlândia: estágio, TCC, atividades complementares, monitoria, extensão, horários e mais. Cada resposta cita o trecho e o PDF oficial de onde a informação saiu.

> [!NOTE]
> O Grizz não substitui a coordenação do curso nem a secretaria. Ele só responde com base nos documentos que conseguiu ler e avisa quando não encontra a informação.

## Funcionalidades

- **Respostas com fontes:** cada afirmação traz uma citação `[n]` com link para o PDF oficial.
- **Respostas por curso e currículo:** na primeira conversa o Grizz pergunta o curso e o ano de ingresso. Com isso ele identifica o currículo do aluno e não mistura as normas de cursos diferentes. Os cursos atendidos são, na FACOM, Ciência da Computação, Sistemas de Informação (Santa Mônica e Monte Carmelo) e Inteligência Artificial e, no IME, Matemática (bacharelado, licenciatura presencial e licenciatura EaD) e Ciência de Dados e Estatística.
- **Busca híbrida com rerank:** junta a busca por significado (vetorial) com a busca por palavras-chave. Depois, um modelo de linguagem reordena os trechos por relevância.
- **Grafo de conhecimento:** um mapa liga cada documento aos cursos, currículos e assuntos a que ele se aplica e às normas que ele altera, revoga ou cita. A busca usa esse mapa para seguir as regras do Grizz antes mesmo de chamar o modelo: deixa de fora normas de outros cursos, troca normas revogadas pelas que as revogaram e traz junto a versão mais nova de uma norma alterada.
- **Base atualizada sozinha:** um robô lê diariamente a aba Documentos dos sites da [FACOM](https://facom.ufu.br/central-de-conteudos/documentos) e do [IME](https://ime.ufu.br/central-de-conteudos/documentos) e importa o que for novo, inclusive PDFs escaneados, que passam por OCR. Depois, mapeia os documentos novos no grafo.
- **Histórico no navegador:** as conversas ficam só no navegador do aluno. O servidor não guarda nada da conversa.
- **Avaliação das respostas:** o aluno pode marcar 👍 ou 👎. Só as respostas avaliadas são guardadas, de forma anônima, para melhorar o Grizz.
- **Tema claro e escuro.**

## Como funciona

```mermaid
flowchart LR
    subgraph importacao ["Importação (diária, GitHub Actions)"]
        A[Sites da FACOM e do IME] -->|lê a aba Documentos| B[PDFs e páginas]
        B -->|texto ou OCR| C[Trechos por artigo]
        C -->|Gemini| D[(Postgres + pgvector)]
        D -->|regras + Groq| K[(Grafo de conhecimento)]
    end

    subgraph pergunta ["Pergunta"]
        E[Aluno] -->|pergunta + histórico + perfil| F[Servidor Express]
        F -->|perfil + assunto| L[Escopo no grafo]
        L --> G[Busca vetorial]
        L --> H[Busca por palavras-chave]
        G & H -->|fusão RRF| M[Versões no grafo]
        M --> I[Rerank - Groq]
        I -->|5 melhores trechos| J[Resposta - Groq]
        J -->|resposta com citações| E
    end

    D -.-> G & H
    K -.-> L & M
```

1. **Importação:** os documentos são baixados e o texto é extraído. PDFs escaneados passam por OCR. O texto é dividido em trechos que respeitam os artigos das normas ("Art. 1º…"), e cada trecho vira um vetor de 768 dimensões gerado pelo Gemini.
2. **Grafo:** cada documento vira um nó ligado aos cursos, currículos, unidade e assuntos a que se aplica, e às outras normas do acervo que ele altera, revoga ou cita. As ligações vêm de regras (padrões no título, na ementa e nas referências "Resolução nº X/AAAA" do texto) e de uma leitura do início do documento por um modelo da Groq. Ao ligar uma norma a outra, o órgão emissor é conferido: a "Resolução nº 2/2019 do Colegiado" não é confundida com a nº 2/2019 do Conselho da FACOM.
3. **Busca:** com o perfil do aluno, o grafo define o escopo: saem os documentos que valem só para outros cursos ou para a outra unidade, e os documentos do curso dele sobre o assunto da pergunta (estágio, TCC, monitoria…) entram como candidatos extras. A pergunta é procurada de duas formas ao mesmo tempo. A busca vetorial acha trechos de significado parecido, e a busca textual em português, que ignora acentos, acha termos exatos como "Resolução 19/2024". As duas listas são combinadas com *Reciprocal Rank Fusion*.
4. **Versões:** trechos de normas revogadas saem, e as normas que alteraram ou revogaram um documento encontrado entram na lista. Uma citação a uma norma com várias versões no acervo (original, republicação, texto consolidado) liga todas elas. Quando as regras e o modelo encontram a mesma revogação, a norma revogada é marcada como `revogado` no banco, apontando para a que a revogou. Uma norma nunca é marcada como revogada por outra mais antiga.
5. **Rerank:** um modelo da Groq dá uma nota de 0 a 10 para cada trecho, considerando o curso do aluno e a quem o documento vale, e descarta os irrelevantes. Se nada do curso do aluno sobrar, a busca é refeita no acervo todo e o Grizz avisa de qual curso é a regra.
6. **Resposta:** o Grizz responde só com base nos trechos escolhidos, citando cada um. Cada documento chega ao modelo com as linhas "Vale para", "Alterado por", "Altera" e "Menciona", tiradas do grafo. Quando a busca vetorial fica indisponível, por exemplo com a cota do Gemini esgotada, a busca continua só com palavras-chave.

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
npm run sync          # importa os documentos dos sites da FACOM e do IME (demora; veja a nota abaixo)
npm run graph         # monta o grafo de conhecimento dos documentos importados
npm run dev           # sobe o servidor e reinicia a cada alteração
```

Abra **http://localhost:3000**.

> [!IMPORTANT]
> Abra a página pelo endereço do servidor (`localhost:3000`). Se abrir pelo Live Server do VS Code ou direto pelo arquivo `index.html`, as perguntas não funcionam, porque a página não encontra a API.

> [!TIP]
> A primeira importação é longa e pode esbarrar no limite diário gratuito do Gemini. Se isso acontecer, ela para sozinha com o aviso "cota diária do Gemini esgotada". É só rodar `npm run sync` de novo no dia seguinte: o que já foi importado é pulado.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | URL de conexão com o Postgres. O SSL é definido pelo `sslmode` da própria URL. |
| `GEMINI_API_KEY` | sim | Chave da API do Gemini, usada para gerar os embeddings. |
| `GROQ_API_KEY` | sim | Chave da API da Groq, usada para gerar as respostas e fazer o rerank. |
| `GROQ_MODEL` | não | Modelo das respostas. Padrão: `openai/gpt-oss-120b`. |
| `GROQ_RERANK_MODEL` | não | Modelo do rerank, da leitura do perfil do aluno e da reescrita das perguntas. Padrão: `openai/gpt-oss-20b`. |
| `GROQ_GRAPH_MODEL` | não | Modelo que lê os documentos para montar o grafo. Padrão: `qwen/qwen3.8-27b`. Use um modelo diferente dos do chat: cada modelo tem a sua cota diária na Groq, e a montagem do grafo gasta muitos tokens. |
| `GRAPH_MAX_DOCS` | não | Quantos documentos o modelo lê por rodada de `npm run graph`. Padrão: `80`. |
| `EMBED_TEXTS_PER_MINUTE` | não | Limite de requisições por minuto (RPM) do seu plano no Gemini. Padrão: `100`. |
| `EMBED_TOKENS_PER_MINUTE` | não | Limite de tokens por minuto (TPM) do seu plano no Gemini. Padrão: `30000`. |
| `IME_IP` | não | O mesmo que `FACOM_IP`, para o site do IME (`ime.ufu.br`). |
| `FACOM_IP` | não | IP do servidor do site da FACOM. Só use se o DNS de `facom.ufu.br` falhar: a importação passa a acessar o site direto por esse IP. Para descobrir o IP, abra o site no navegador e veja **Remote Address** nas ferramentas de desenvolvedor (F12 → Network). Remova quando o DNS voltar a funcionar. |
| `PORT` | não | Porta do servidor. Padrão: `3000`. |

> [!NOTE]
> A lista de modelos da Groq muda com frequência. Se um modelo deixar de existir, consulte os disponíveis em `GET https://api.groq.com/openai/v1/models` e defina `GROQ_MODEL` e `GROQ_RERANK_MODEL`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o servidor com `nodemon`, que reinicia a cada alteração. |
| `npm start` | Sobe o servidor, para produção. |
| `npm run migrate` | Aplica as migrations de `db/migrations` que ainda não rodaram. |
| `npm run sync` | Importa os documentos novos da aba Documentos dos sites da FACOM e do IME. |
| `npm run sync:facom` / `npm run sync:ime` | Importa só de uma unidade. |
| `npm run sync -- --dry-run` | Só lista o que seria importado, sem gravar nada. |
| `npm run graph` | Mapeia no grafo os documentos que ainda não foram lidos pelo modelo. Lê até 80 por rodada (`-- --limit=N` para mudar) e para quando a cota diária do modelo acaba. Sem `GROQ_API_KEY`, ou com `-- --rules-only`, usa só as regras. Com `-- --rebuild`, refaz o grafo inteiro. Com `-- --references`, refaz só as referências entre normas (altera, revoga, cita) de todos os documentos, pelas regras e sem gastar cota do modelo. |
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

O workflow [`.github/workflows/sync-documents.yml`](.github/workflows/sync-documents.yml) roda todo dia por volta das 6h17 (horário de Brasília). O GitHub pode atrasar tarefas agendadas em alguns minutos ou horas quando está com muita demanda. Ele aplica as migrations, importa os documentos novos das duas unidades, marca os duplicados e atualiza o grafo de conhecimento. Também dá para rodá-lo na mão pela aba **Actions**, em **Run workflow**.

Para ele funcionar, cadastre em **Settings → Secrets and variables → Actions** os segredos `DATABASE_URL`, `GEMINI_API_KEY` e `GROQ_API_KEY`. O último é usado pelo grafo; sem ele, o grafo é montado só com as regras.

### Filtros da importação

Nem tudo o que as unidades publicam interessa aos alunos. Os filtros de cada unidade ficam em `skipTitles` e `skipFiles`, no arquivo [`services/unitCrawler.js`](services/unitCrawler.js). Hoje ficam de fora arquivos que não são PDF e documentos sobre a vida funcional dos professores, concursos, eleições e eventos. No IME também ficam de fora o material didático, as reportagens sobre a profissão e as chamadas de parcerias.

Para incluir outra unidade da UFU com o mesmo modelo de site, basta acrescentá-la em `UNITS`, no [`services/unitCrawler.js`](services/unitCrawler.js), e cadastrar os cursos dela no [`services/courses.js`](services/courses.js).

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
│   ├── search.js             # busca híbrida, fusão RRF e uso do grafo
│   ├── knowledgeGraph.js     # grafo de conhecimento: montagem e consulta
│   ├── reranker.js           # rerank dos trechos com a Groq
│   ├── profile.js            # leitura do curso e ano informados pelo aluno
│   ├── courses.js            # unidades, cursos e seus currículos
│   ├── llm.js                # cliente da Groq
│   ├── embeddings.js         # cliente do Gemini, com controle de cota
│   ├── extractor.js          # texto de PDFs e páginas HTML
│   ├── ocr.js                # OCR de PDFs escaneados
│   ├── chunker.js            # divisão do texto em trechos por artigo
│   ├── ingestion.js          # importação de um documento
│   └── unitCrawler.js        # leitura da aba Documentos dos sites da FACOM e do IME
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
| `categories` e `document_categories` | Categorias dos documentos. A categoria `facom` ou `ime` indica a unidade de origem. |
| `kg_nodes` e `kg_edges` | Grafo de conhecimento. Nós: unidades, cursos, currículos, assuntos e documentos. Arestas: `pertence_a`, `emitido_por`, `aplica_a`, `trata_de`, `altera`, `revoga` e `cita`, com a origem de cada uma (`regra` ou `llm`). |
| `feedback` | Respostas avaliadas pelos alunos, sem identificação. |

## Limitações conhecidas

- **Cobertura:** o Grizz só conhece o que foi importado. Normas da PROGRAD (matrícula, trancamento, calendário) ainda não entram automaticamente e precisam ser adicionadas pelo `npm run ingest`.
- **Tabela de currículos:** a relação entre ano de ingresso e currículo, em [`services/courses.js`](services/courses.js), foi montada a partir dos títulos dos projetos pedagógicos. No IME, os anos de início das turmas da Matemática EaD são aproximados, tirados das datas dos projetos pedagógicos de cada turma. Vale confirmar com as coordenações.
- **Grafo:** as ligações lidas pelo modelo podem errar, e um documento ligado ao curso errado deixa de aparecer para os alunos do curso certo. As ligações ficam em `kg_edges` para conferência e podem ser refeitas com `npm run graph -- --rebuild`.
- **Perguntas de continuação:** antes de buscar, um modelo da Groq reescreve a mensagem como uma pergunta completa usando as últimas mensagens ("e o prazo?" vira "Qual o prazo do relatório de estágio?"). Se a reescrita falhar, a busca usa a pergunta atual junto com a mensagem anterior do aluno, e continuações muito curtas podem buscar pior.
- **Histórico:** fica só no navegador. Ele não sincroniza entre dispositivos e some se os dados do navegador forem limpos.

## Licença

Distribuído sob a licença ISC. Veja o arquivo [LICENSE](LICENSE).

---

Feito pela Liga Acadêmica DataLab - UFU · As respostas se baseiam nos documentos oficiais da UFU.
