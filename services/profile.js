const { complete, RERANK_MODEL } = require('./llm');
const { COURSES } = require('./courses');

const COURSE_LIST = Object.entries(COURSES).map(([id, c]) => `- "${id}": ${c.name}`).join('\n');

const SYSTEM_PROMPT = `Você extrai informações da mensagem de um estudante da FACOM/UFU.
Cursos possíveis:
${COURSE_LIST}

Responda só com JSON no formato:
{"course": "<id do curso ou null>", "entryYear": <ano de ingresso com 4 dígitos ou null>, "siCampusUnknown": <true|false>, "hasQuestion": <true|false>, "needsCourse": <true|false>, "needsEntryYear": <true|false>, "prospective": <true|false>, "offTopic": <true|false>, "declined": <true|false>}

- course: só preencha se o estudante disser o curso. "BCC", "CC" e "computação" = "bcc"; "BIA" e "IA" = "bia".
  Se disser Sistemas de Informação sem indicar o campus, use null e siCampusUnknown = true.
- entryYear: ano em que o estudante ENTROU na UFU. Converta expressões relativas usando o ano atual
  (ex.: "entrei ano passado"). Se ele disser só o período em que está, use null.
- hasQuestion: true se a mensagem tem alguma dúvida ou pedido além de informar curso e ano.
- needsCourse: true se a resposta muda conforme o curso do estudante e o curso ainda não está claro na conversa
  (ex.: estágio, TCC, grade, disciplinas, horários, atividades complementares, monitoria do curso).
  false se a dúvida já cita o curso, se vale igual para toda a FACOM/UFU (ligas acadêmicas, eleições, extensão em geral,
  pós-graduação, quem procurar para algo) ou se a mensagem não tem dúvida.
- needsEntryYear: true só se a resposta muda conforme o CURRÍCULO em que o estudante está, ou seja, depende de quando
  ele entrou: grade curricular, disciplinas de um período, carga horária total, pré-requisitos, equivalências,
  horas de atividades complementares, regras de TCC do currículo dele.
  false para normas que valem para o curso inteiro independentemente do currículo (ex.: regras de estágio,
  monitoria, horários de aula), para perguntas sobre o curso como ele é hoje (ex.: "qual a ementa do curso novo de IA",
  "como é o curso de BCC") e para tudo que não depende do curso.
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
            needsEntryYear: data.needsEntryYear === true,
            prospective: data.prospective === true,
            offTopic: data.offTopic === true,
            declined: data.declined === true,
        };
    } catch (err) {
        console.error(`extração do perfil falhou: ${err.message}`);
        return { course: null, entryYear: null, siCampusUnknown: false, hasQuestion: true, needsCourse: false, needsEntryYear: false, prospective: false, offTopic: false, declined: false };
    }
}

function askForProfile({ missingCourse, missingYear, siCampusUnknown }) {
    const year = 'em que ano você entrou na UFU (se ainda não entrou, é só me dizer)';
    if (missingCourse && siCampusUnknown) {
        return `Sistemas de Informação, beleza! Mas de qual campus: Santa Mônica (Uberlândia) ou Monte Carmelo?${missingYear ? ` E ${year}?` : ''} Cada campus tem as suas normas.`;
    }
    if (missingCourse && missingYear) {
        return `Antes de farejar os documentos, me conta: qual curso você faz e ${year}? Assim eu sei qual currículo vale pra você e não te passo regra errada.`;
    }
    if (missingCourse) {
        return 'Antes de farejar os documentos, me conta: qual curso você faz (ou pretende fazer)? Cada curso tem as suas normas.';
    }
    return `Show! E ${year}? Essa resposta muda conforme o currículo, e o currículo depende de quando você entrou.`;
}

module.exports = { extractProfile, askForProfile };
