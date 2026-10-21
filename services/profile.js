const { complete, RERANK_MODEL } = require('./llm');
const { COURSES } = require('./courses');

const COURSE_LIST = Object.entries(COURSES).map(([id, c]) => `- "${id}": ${c.name}`).join('\n');

const SYSTEM_PROMPT = `Você extrai informações da mensagem de um estudante da FACOM/UFU.
Cursos possíveis:
${COURSE_LIST}

Responda só com JSON no formato:
{"course": "<id do curso ou null>", "entryYear": <ano de ingresso com 4 dígitos ou null>, "siCampusUnknown": <true|false>, "hasQuestion": <true|false>, "needsProfile": <true|false>, "declined": <true|false>}

- course: só preencha se o estudante disser o curso. "BCC", "CC" e "computação" = "bcc"; "BIA" e "IA" = "bia".
  Se disser Sistemas de Informação sem indicar o campus, use null e siCampusUnknown = true.
- entryYear: ano em que o estudante ENTROU na UFU. Converta expressões relativas usando o ano atual
  (ex.: "entrei ano passado"). Se ele disser só o período em que está, use null.
- hasQuestion: true se a mensagem tem alguma dúvida ou pedido além de informar curso e ano.
- needsProfile: true só se a resposta da dúvida muda conforme o curso ou o currículo do estudante. Exemplos:
  true: estágio (cada curso tem sua norma), TCC, grade curricular, disciplinas de um período, carga horária do curso,
  atividades complementares, pré-requisitos, equivalências, horários de aula, monitoria do curso.
  false: assuntos que valem igual para toda a FACOM/UFU (ligas acadêmicas, eleições, extensão em geral, pós-graduação,
  quem procurar para algo), cumprimentos, agradecimentos e mensagens sem dúvida.
  Na dúvida entre os dois, use true.
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
            needsProfile: data.needsProfile !== false,
            declined: data.declined === true,
        };
    } catch (err) {
        console.error(`extração do perfil falhou: ${err.message}`);
        return { course: null, entryYear: null, siCampusUnknown: false, hasQuestion: true, needsProfile: true, declined: false };
    }
}

function askForProfile({ course, entryYear, siCampusUnknown }) {
    const why = 'Assim eu sei qual currículo vale pra você e não te passo regra errada.';
    if (!course && siCampusUnknown) {
        return `Sistemas de Informação, beleza! Mas de qual campus: Santa Mônica (Uberlândia) ou Monte Carmelo?${entryYear ? '' : ' E em que ano você entrou na UFU?'} ${why}`;
    }
    if (!course && !entryYear) {
        return `Antes de farejar os documentos, me conta: qual curso você faz e em que ano entrou na UFU? ${why}`;
    }
    if (!course) return `Show! E qual curso você faz? ${why}`;
    return `Show! E em que ano você entrou na UFU? ${why}`;
}

module.exports = { extractProfile, askForProfile };
