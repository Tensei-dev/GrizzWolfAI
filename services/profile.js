const { complete, RERANK_MODEL } = require('./llm');
const { COURSES } = require('./courses');

const COURSE_LIST = Object.entries(COURSES).map(([id, c]) => `- "${id}": ${c.name}`).join('\n');

const SYSTEM_PROMPT = `Você extrai informações da mensagem de um estudante da FACOM/UFU.
Cursos possíveis:
${COURSE_LIST}

Responda só com JSON no formato:
{"course": "<id do curso ou null>", "entryYear": <ano de ingresso com 4 dígitos ou null>, "siCampusUnknown": <true|false>, "hasQuestion": <true|false>, "needsCourse": <true|false>, "prospective": <true|false>, "offTopic": <true|false>, "declined": <true|false>}

- course: só preencha se o estudante disser o curso. "BCC", "CC" e "computação" = "bcc"; "BIA" e "IA" = "bia".
  Se disser Sistemas de Informação sem indicar o campus, use null e siCampusUnknown = true.
- entryYear: ano em que o estudante ENTROU na UFU. Converta expressões relativas usando o ano atual
  (ex.: "entrei ano passado"). Se ele disser só o período em que está, use null.
- hasQuestion: true só se a MENSAGEM ATUAL, sozinha, traz uma dúvida ou pedido novo. Dúvidas que aparecem só no histórico
  não contam. Responder a uma pergunta do Grizz (curso, ano, campus, "ainda não entrei") não é dúvida: use false.
- needsCourse: true se a resposta muda conforme o curso do estudante e o curso ainda não está claro na conversa
  (ex.: estágio, TCC, grade, disciplinas, horários, atividades complementares, monitoria do curso).
  false se a dúvida já cita o curso, se vale igual para toda a FACOM/UFU (ligas acadêmicas, eleições, extensão em geral,
  pós-graduação, quem procurar para algo) ou se a mensagem não tem dúvida.
- prospective: true se o estudante diz que ainda não entrou na UFU, que vai prestar ou que está pensando em cursar.
- offTopic: true se a mensagem pede algo fora da vida acadêmica na UFU/FACOM (ex.: receitas, futebol, política,
  piadas, fazer o exercício ou o código do estudante, perguntas gerais de conhecimento ou de programação).
  false para dúvidas sobre normas, cursos, disciplinas, estágio, TCC, documentos, prazos e procedimentos da UFU/FACOM,
  e também para cumprimentos, agradecimentos, respostas sobre curso e ano e perguntas sobre o próprio Grizz.
- declined: true se o estudante se recusa a informar ou diz que não sabe (ex.: "prefiro não dizer", "tanto faz, só responde").

Use o histórico da conversa para interpretar respostas curtas: se o Grizz perguntou o campus de
Sistemas de Informação e o estudante respondeu "Santa Mônica", o curso é "bsi"; se respondeu "Monte Carmelo", é "bsi-mc".
Considere curso e ano informados em qualquer mensagem do histórico, não só na última.`;

const HISTORY_MESSAGES = 4;

async function extractProfile(message, history = []) {
    const context = history
        .slice(-HISTORY_MESSAGES)
        .map((m) => `${m.role === 'user' ? 'Estudante' : 'Grizz'}: ${m.content}`)
        .join('\n');
    try {
        const raw = await complete(
            [
                { role: 'system', content: `${SYSTEM_PROMPT}\n\nAno atual: ${new Date().getFullYear()}.` },
                {
                    role: 'user',
                    content: `${context ? `Histórico:\n${context}\n\n` : ''}Mensagem atual do estudante: ${message}`,
                },
            ],
            { model: RERANK_MODEL, temperature: 0, json: true, reasoningEffort: 'low' }
        );
        const data = JSON.parse(raw);
        const year = Number(data.entryYear);
        return {
            course: COURSES[data.course] ? data.course : null,
            entryYear: Number.isInteger(year) && year >= 1980 && year <= new Date().getFullYear() ? year : null,
            siCampusUnknown: data.siCampusUnknown === true,
            hasQuestion: data.hasQuestion !== false,
            needsCourse: data.needsCourse === true,
            prospective: data.prospective === true,
            offTopic: data.offTopic === true,
            declined: data.declined === true,
        };
    } catch (err) {
        console.error(`extração do perfil falhou: ${err.message}`);
        return { course: null, entryYear: null, siCampusUnknown: false, hasQuestion: true, needsCourse: false, prospective: false, offTopic: false, declined: false };
    }
}

function askForCourse({ siCampusUnknown }) {
    if (siCampusUnknown) {
        return 'Sistemas de Informação, beleza! Mas de qual campus: Santa Mônica (Uberlândia) ou Monte Carmelo? Cada campus tem as suas normas.';
    }
    return 'Antes de farejar os documentos, me conta: qual curso você faz (ou pretende fazer)? Cada curso tem as suas normas.';
}

const VERSIONS_PROMPT = `Você recebe a pergunta de um estudante da FACOM/UFU e os documentos oficiais VIGENTES que a busca encontrou para ela.
Responda só com JSON: {"needsEntryYear": <true|false>}

needsEntryYear = true somente se, entre esses documentos, houver dois ou mais documentos DIFERENTES que regulam o MESMO
assunto da pergunta para o MESMO curso (ex.: dois projetos pedagógicos vigentes do mesmo curso; duas resoluções vigentes
com normas de estágio do mesmo curso; a grade de um currículo antigo e a de um currículo novo).

needsEntryYear = false se só um documento trata do assunto da pergunta, se os documentos são de cursos diferentes,
se tratam de assuntos diferentes, ou se são o mesmo documento (ex.: texto original e texto consolidado da mesma resolução).
Se o curso do estudante for informado, ignore os documentos de outros cursos.`;

const MAX_SNIPPET_CHARS = 300;

const COURSE_PATTERNS = [
    ['bia', /intelig[eê]ncia artificial/i],
    ['bsi-mc', /monte carmelo/i],
    ['bsi', /sistemas de informa[cç][aã]o/i],
    ['bcc', /ci[eê]ncia da computa[cç][aã]o/i],
];

function documentCourse(chunk) {
    const text = `${chunk.title} ${chunk.subject || ''}`;
    return COURSE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

async function hasCompetingVersions(question, chunks, { courseId = null, courseName = null } = {}) {
    const documents = new Map();
    for (const c of chunks) {
        const key = c.number || `doc-${c.document_id}`;
        if (!documents.has(key)) documents.set(key, { ...c, course: documentCourse(c) });
    }

    let candidates = [...documents.values()];
    if (courseId) {
        candidates = candidates.filter((d) => d.course === courseId);
    } else {
        const perCourse = {};
        for (const d of candidates) if (d.course) perCourse[d.course] = (perCourse[d.course] || 0) + 1;
        candidates = candidates.filter((d) => d.course && perCourse[d.course] >= 2);
    }
    if (candidates.length < 2) return false;

    const list = candidates
        .map((c, i) => `[${i + 1}] ${c.title}${c.subject ? `\nEmenta: ${c.subject}` : ''}\nTrecho: ${c.content.slice(0, MAX_SNIPPET_CHARS)}`)
        .join('\n\n');
    try {
        const raw = await complete(
            [
                { role: 'system', content: VERSIONS_PROMPT },
                {
                    role: 'user',
                    content: `${courseName ? `Curso do estudante: ${courseName}\n` : ''}Pergunta: ${question}\n\nDocumentos vigentes:\n\n${list}`,
                },
            ],
            { model: RERANK_MODEL, temperature: 0, json: true, reasoningEffort: 'low' }
        );
        return JSON.parse(raw).needsEntryYear === true;
    } catch (err) {
        console.error(`checagem de normas concorrentes falhou: ${err.message}`);
        return false;
    }
}

module.exports = { extractProfile, askForCourse, hasCompetingVersions };
