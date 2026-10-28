const Graph = require('../models/KnowledgeGraph');
const { complete, GRAPH_MODEL, DailyLimitError } = require('./llm');
const { UNITS, COURSES, courseOfText } = require('./courses');

// O grafo liga cada documento às unidades, cursos, currículos e assuntos a que ele se aplica, e às normas que
// ele altera, revoga ou cita. A busca usa essas ligações para aplicar as regras do prompt do Grizz antes do LLM:
// norma de outro curso não vale para o estudante, a norma mais nova prevalece e a regra pode depender de outro documento.

const UFU = 'ufu';
const ALL_UNITS = { ...Object.fromEntries(Object.entries(UNITS).map(([id, u]) => [id, `todos os cursos da ${u.name}`])), [UFU]: 'toda a UFU' };

const TOPICS = {
    estagio: ['Estágio', /est[aá]gio/i],
    tcc: ['Trabalho de Conclusão de Curso', /\btcc\b|trabalho de conclus[aã]o|monografia|projeto de gradua[cç][aã]o/i],
    'atividades-complementares': ['Atividades complementares', /atividades? (acad[eê]micas? )?complementares|\bacgs?\b|horas complementares/i],
    extensao: ['Extensão e ACE', /extens[aã]o|\baces?\b|siex/i],
    monitoria: ['Monitoria', /monitori|monitor(es)?\b/i],
    matricula: ['Matrícula, rematrícula e trancamento', /matr[ií]cula|trancamento|rematr/i],
    'grade-curricular': ['Projeto pedagógico e grade curricular', /projeto (pol[ií]tico[- ])?pedag[oó]gico|\bppc\b|grade|estrutura curricular|fluxo curricular|curr[ií]culo|optativ|pr[eé]-?requisito/i],
    'plano-de-ensino': ['Planos de ensino e fichas de disciplinas', /planos? de ensino|fichas? d[ea] disciplina|\bementas?\b|bibliografia/i],
    horarios: ['Horários e oferta de disciplinas', /hor[aá]rios?\b|oferta de disciplina/i],
    colegiado: ['Colegiado, conselhos e regimentos', /colegiado|regimento|\bnde\b|n[uú]cleo docente|coordena[cç][aã]o do curso/i],
    laboratorios: ['Laboratórios', /laborat[oó]rio/i],
    programas: ['PET, PIBID, Residência Pedagógica e bolsas', /\bpet\b|pibid|resid[eê]ncia pedag|inicia[cç][aã]o cient|bolsas?\b|picei/i],
    ingresso: ['Ingresso, transferência e reconhecimento do curso', /ingresso|transfer[eê]ncia|portador de diploma|reconhecimento do curso|vagas ociosas/i],
    aproveitamento: ['Aproveitamento de estudos e equivalência', /aproveitamento de (estudos|disciplina)|equival[eê]ncia|dispensa de disciplina/i],
    calendario: ['Calendário acadêmico', /calend[aá]rio/i],
    docentes: ['Vida funcional dos professores', /afastamento|progress[aã]o|qualifica[cç][aã]o (docente|de docentes)|carga hor[aá]ria did[aá]tica/i],
};

const UFU_WIDE = /\b(CONGRAD|CONSEX|CONSUN|CONDIR|CNE|INEP|MEC)\b|lei federal|lei n[º°o.]|decreto/i;

function detectTopics(text) {
    return Object.keys(TOPICS).filter((key) => TOPICS[key][1].test(text));
}

const curriculumKey = (courseId, name) => `${courseId}:${name}`;

// ---------- Taxonomia: unidades, cursos, currículos e assuntos ----------

async function ensureTaxonomy() {
    const ids = { unidade: {}, curso: {}, curriculo: {}, assunto: {} };
    for (const [key, label] of Object.entries(ALL_UNITS)) {
        ids.unidade[key] = await Graph.upsertNode({ type: 'unidade', key, label });
    }
    for (const [courseId, course] of Object.entries(COURSES)) {
        ids.curso[courseId] = await Graph.upsertNode({ type: 'curso', key: courseId, label: course.name });
        await Graph.addEdge(ids.curso[courseId], 'pertence_a', ids.unidade[course.unit]);
        for (const c of course.curricula) {
            const key = curriculumKey(courseId, c.name);
            ids.curriculo[key] = await Graph.upsertNode({ type: 'curriculo', key, label: `${course.name}, currículo ${c.name}` });
            await Graph.addEdge(ids.curriculo[key], 'pertence_a', ids.curso[courseId]);
        }
    }
    for (const [key, [label]] of Object.entries(TOPICS)) {
        ids.assunto[key] = await Graph.upsertNode({ type: 'assunto', key, label });
    }
    return ids;
}

let taxonomyCache = null;
function taxonomyIds() {
    taxonomyCache ||= (async () => {
        const ids = {};
        ids.unidade = await Graph.nodeIds('unidade', Object.keys(ALL_UNITS));
        ids.curso = await Graph.nodeIds('curso', Object.keys(COURSES));
        ids.curriculo = await Graph.nodeIds('curriculo', Object.entries(COURSES)
            .flatMap(([id, c]) => c.curricula.map((cur) => curriculumKey(id, cur.name))));
        if (!Object.keys(ids.curso).length) throw new Error('grafo vazio; rode npm run graph');
        return ids;
    })().catch((err) => { taxonomyCache = null; throw err; });
    return taxonomyCache;
}

// ---------- Referências entre normas ----------

const REFERENCE = /\b(resolu[cç][aã]o|portaria|edital)\b([^\n;]{0,60}?)(?:n[º°o.]\.?\s*)?(?<![\d/.])(\d{1,3}(?:\.\d{3})?)\s*\/\s*((?:19|20)\d{2})\b/gi;

function normalizeNumber(number) {
    const m = String(number || '').match(/(\d{1,3}(?:\.\d{3})?)\s*\/\s*(\d{4})/);
    return m ? `${Number(m[1].replace('.', ''))}/${m[2]}` : null;
}

function relationBefore(text, index) {
    const before = text.slice(Math.max(0, index - 60), index);
    if (/revog/i.test(before)) return 'revoga';
    if (/alter|nova reda[cç][aã]o|modific/i.test(before)) return 'altera';
    return 'cita';
}

// Mesmo número, órgãos diferentes: a "Resolução nº 2/2019 do Colegiado do Curso" não é a nº 2/2019 do Conselho da FACOM.
const ISSUER_FAMILIES = [
    ['colegiado', /colegiado|\bCOLCO\w*/i],
    ['universidade', /\b(CONGRAD|CONSUN|CONSEX|CONDIR)\b|conselho (universit[aá]rio|de gradua[cç][aã]o|de extens[aã]o|diretor)/i],
    ['unidade', /\b(CONFACOM|CONIME|CONIM|CONFAMAT)\b|conselho d[ao] (faculdade|instituto)/i],
];
const issuerFamily = (text) => ISSUER_FAMILIES.find(([, pattern]) => pattern.test(text || ''))?.[0] || null;

function resolveReference(doc, { number, kind, context }, docsByNumber) {
    let candidates = (docsByNumber.get(number) || []).filter((d) => d.id !== doc.id);
    const family = issuerFamily(context);
    if (family) candidates = candidates.filter((d) => [family, null].includes(issuerFamily(`${d.issuer} ${d.title}`)));
    if (candidates.length > 1) {
        const sameUnit = candidates.filter((d) => d.unit === doc.unit);
        if (sameUnit.length) candidates = sameUnit;
    }
    if (candidates.length > 1 && context) {
        const sameIssuer = candidates.filter((d) => d.issuer && context.toUpperCase().includes(d.issuer));
        if (sameIssuer.length) candidates = sameIssuer;
    }
    if (candidates.length > 1 && kind) {
        const sameKind = candidates.filter((d) => d.doc_type.startsWith(kind.slice(0, 5)));
        if (sameKind.length) candidates = sameKind;
    }
    return candidates.length === 1 ? candidates[0] : null;
}

function findReferences(doc, text) {
    const own = normalizeNumber(doc.number);
    const refs = [];
    for (const m of text.matchAll(REFERENCE)) {
        const number = normalizeNumber(`${m[3]}/${m[4]}`);
        if (number === own) continue;
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80).split(/[.;\n]/)[0];
        refs.push({ number, kind: m[1].toLowerCase(), context: `${m[2]} ${after}`, relation: relationBefore(text, m.index) });
    }
    return refs;
}

// ---------- Leitura do documento pelo LLM ----------

const EXTRACT_PROMPT = `Você monta o mapa de normas de um acervo de documentos oficiais da UFU.
Recebe um documento publicado por uma unidade acadêmica e responde só com JSON no formato:
{"scope": "curso" | "unidade" | "ufu", "courses": ["<id>"], "curricula": ["<id>"], "topics": ["<id>"], "alters": [{"number": "n/aaaa", "issuer": "<órgão>"}], "revokes": [{"number": "n/aaaa", "issuer": "<órgão>"}]}

- scope "curso": o documento vale só para um ou mais cursos específicos (preencha courses). Normas de estágio, TCC,
  atividades complementares, projeto pedagógico, grade, horários, fichas de disciplinas e colegiado de UM curso são "curso".
- scope "unidade": vale para todos os cursos da unidade (ex.: regimento da unidade, normas de extensão da unidade, docentes).
- scope "ufu": norma geral da universidade ou nacional (CONGRAD, CONSEX, MEC, CNE, leis), mesmo que publicada pela unidade.
- courses: ids dos cursos da lista; [] se o scope não for "curso".
- curricula: só se o documento disser que vale para um currículo, versão ou turma específica (ex.: projeto pedagógico 2018,
  grade 2023-1, turma 4). Senão [].
- topics: de 1 a 3 assuntos principais do documento, da lista. Não liste assuntos citados só de passagem.
- alters / revokes: normas que este documento altera ou revoga expressamente, com o número (ex.: "3/2022") e o órgão
  que as emitiu, como aparece no texto (ex.: "Conselho da Faculdade de Computação", "Colegiado do Curso de ...", "CONGRAD").
  Não inclua o próprio documento nem normas só citadas.`;

const MAX_EXCERPT_CHARS = 2500;

async function extractWithLlm(doc, excerpt) {
    const courses = Object.entries(COURSES).filter(([, c]) => c.unit === doc.unit);
    const courseList = courses.map(([id, c]) => `- "${id}": ${c.name}`).join('\n');
    const curriculumList = courses
        .flatMap(([id, c]) => c.curricula.map((cur) => `- "${curriculumKey(id, cur.name)}": ${c.name}, currículo ${cur.name}`))
        .join('\n');
    const topicList = Object.entries(TOPICS).map(([id, [label]]) => `- "${id}": ${label}`).join('\n');

    const raw = await complete(
        [
            { role: 'system', content: EXTRACT_PROMPT },
            {
                role: 'user',
                content: `Unidade: ${UNITS[doc.unit]?.fullName || 'desconhecida'}\nCursos da unidade:\n${courseList}\nCurrículos:\n${curriculumList}\nAssuntos:\n${topicList}\n\n`
                    + `Título: ${doc.title}${doc.number ? `\nNúmero: ${doc.number}` : ''}${doc.subject ? `\nEmenta: ${doc.subject}` : ''}\n\nInício do texto:\n${excerpt}`,
            },
        ],
        {
            model: GRAPH_MODEL,
            temperature: 0,
            json: true,
            reasoningEffort: GRAPH_MODEL.startsWith('openai/gpt-oss') ? 'low' : null,
            maxAttempts: 6,
            maxRetryDelayMs: 90000,
        }
    );
    const data = JSON.parse(raw.replace(/<think>[\s\S]*?<\/think>/g, ''));
    const list = (value) => (Array.isArray(value) ? value.map(String) : []);
    const refs = (value, relation) => (Array.isArray(value) ? value : [])
        .map((r) => ({ number: normalizeNumber(r?.number ?? r), context: typeof r?.issuer === 'string' ? r.issuer : null, relation }));
    return {
        scope: ['curso', 'unidade', 'ufu'].includes(data.scope) ? data.scope : null,
        courses: list(data.courses).filter((id) => COURSES[id]?.unit === doc.unit),
        curricula: list(data.curricula).filter((key) => COURSES[key.split(':')[0]]?.unit === doc.unit),
        topics: list(data.topics).filter((id) => TOPICS[id]),
        references: [...refs(data.alters, 'altera'), ...refs(data.revokes, 'revoga')]
            .filter((r) => r.number && r.number !== normalizeNumber(doc.number)),
    };
}

function extractWithRules(doc) {
    const header = `${doc.title} ${doc.subject || ''}`;
    const course = courseOfText(header, doc.unit);
    let scope = 'unidade';
    if (course) scope = 'curso';
    else if (UFU_WIDE.test(`${doc.issuer || ''} ${header}`)) scope = UFU;
    return { scope, courses: course ? [course] : [], curricula: [], topics: detectTopics(header) };
}

// ---------- Construção do grafo de um documento ----------

async function buildDocument(doc, { taxonomy, docsByNumber, useLlm }) {
    const nodeId = await Graph.upsertNode({ type: 'documento', key: String(doc.id), label: doc.title.slice(0, 300), documentId: doc.id });
    const text = await Graph.documentText(doc.id);
    const rules = extractWithRules(doc);

    let llm = null;
    if (useLlm && text) {
        try {
            llm = await extractWithLlm(doc, text.slice(0, MAX_EXCERPT_CHARS));
        } catch (err) {
            if (err instanceof DailyLimitError) throw err;
            console.error(`  leitura pelo LLM falhou, usando só as regras: ${err.message}`);
        }
    }

    const edges = [];
    const add = (relation, targetId, origin) => { if (targetId) edges.push({ relation, targetId, origin }); };
    for (const unit of doc.units) add('emitido_por', taxonomy.unidade[unit], 'regra');

    // A quem o documento se aplica: currículos específicos, cursos, a unidade inteira ou a UFU toda.
    const source = llm?.scope ? llm : rules;
    const origin = llm?.scope ? 'llm' : 'regra';
    const coursesWithCurriculum = new Set(source.curricula.map((key) => key.split(':')[0]));
    for (const key of source.curricula) add('aplica_a', taxonomy.curriculo[key], origin);
    const courses = source.scope === 'curso' ? (source.courses.length ? source.courses : rules.courses) : [];
    for (const id of courses) if (!coursesWithCurriculum.has(id)) add('aplica_a', taxonomy.curso[id], origin);
    // Publicado pelas duas unidades, uma norma "da unidade" vale para as duas.
    if (!edges.some((e) => e.relation === 'aplica_a')) {
        const units = source.scope === UFU || doc.units.length === 0 ? [UFU] : doc.units;
        for (const unit of units) add('aplica_a', taxonomy.unidade[unit], origin);
    }

    for (const key of new Set([...rules.topics, ...(llm?.topics || [])])) {
        add('trata_de', taxonomy.assunto[key], rules.topics.includes(key) ? 'regra' : 'llm');
    }

    // Normas alteradas, revogadas ou citadas que estão no acervo.
    const references = [
        ...findReferences(doc, text).map((r) => ({ ...r, origin: 'regra' })),
        ...(llm?.references || []).map((r) => ({ ...r, origin: 'llm' })),
    ];
    const strength = { cita: 0, altera: 1, revoga: 2 };
    const byTarget = new Map();
    for (const ref of references) {
        const target = resolveReference(doc, ref, docsByNumber);
        if (!target) continue;
        const current = byTarget.get(target.id);
        if (!current || strength[ref.relation] > strength[current.relation]) byTarget.set(target.id, { ...ref, target });
    }
    for (const { target, relation, origin: refOrigin } of byTarget.values()) {
        const targetNode = await Graph.upsertNode({ type: 'documento', key: String(target.id), label: target.title.slice(0, 300), documentId: target.id });
        add(relation, targetNode, refOrigin);
    }

    await Graph.replaceEdgesFrom(nodeId, edges);
    if (llm) await Graph.markBuilt(doc.id);
    return { edges: edges.length, llm: Boolean(llm), references: byTarget.size };
}

// ---------- Consulta na hora da busca ----------

// Escopo do estudante no grafo: documentos de outros cursos (ou de outra unidade) ficam de fora,
// e os documentos do curso dele sobre o assunto da pergunta entram como candidatos extras.
async function scopeFor(profile, question) {
    if (!profile?.courseId) return null;
    try {
        const ids = await taxonomyIds();
        const course = COURSES[profile.courseId];
        const curricula = profile.curricula.length ? profile.curricula : course.curricula.map((c) => c.name);
        const specific = [ids.curso[profile.courseId], ...curricula.map((name) => ids.curriculo[curriculumKey(profile.courseId, name)])].filter(Boolean);
        const allowed = [...specific, ids.unidade[course.unit], ids.unidade[UFU]].filter(Boolean);
        const topics = detectTopics(question);
        const [excludeIds, focusIds] = await Promise.all([
            Graph.documentsOutside(allowed),
            topics.length ? Graph.documentsAbout(topics, [...specific, ids.unidade[course.unit]].filter(Boolean)) : [],
        ]);
        return { excludeIds, focusIds, topics };
    } catch (err) {
        console.error(`grafo de conhecimento indisponível, buscando sem ele: ${err.message}`);
        return null;
    }
}

// O que o grafo sabe de cada documento: a quem vale, o que altera e quem o alterou ou revogou.
async function describeDocuments(documentIds) {
    const ids = [...new Set(documentIds)];
    const info = new Map(ids.map((id) => [id, { appliesTo: [], courses: [], alters: [], cites: [], alteredBy: [], revokedBy: [] }]));
    if (!ids.length) return info;

    for (const row of await Graph.edgesOfDocuments(ids)) {
        const own = info.get(row.source_document);
        if (own && row.relation === 'aplica_a') {
            own.appliesTo.push(row.target_label);
            if (row.target_type === 'curso') own.courses.push(row.target_key);
            if (row.target_type === 'curriculo') own.courses.push(row.target_key.split(':')[0]);
        }
        if (own && ['altera', 'revoga'].includes(row.relation) && row.target_document) own.alters.push(row.target_label);
        if (own && row.relation === 'cita' && row.target_document) own.cites.push(row.target_label);

        const target = info.get(row.target_document);
        if (target && row.source_status === 'vigente' && row.source_document !== row.target_document) {
            const by = { documentId: row.source_document, title: row.source_title, number: row.source_number };
            if (row.relation === 'altera') target.alteredBy.push(by);
            if (row.relation === 'revoga') target.revokedBy.push(by);
        }
    }
    for (const i of info.values()) i.courses = [...new Set(i.courses)];
    return info;
}

module.exports = {
    TOPICS, detectTopics, ensureTaxonomy, buildDocument, normalizeNumber, scopeFor, describeDocuments,
};
