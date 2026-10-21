const { hybridSearch } = require('./search');
const { complete, CHAT_MODEL } = require('./llm');
const { extractProfile, askForCourse, hasCompetingVersions } = require('./profile');
const { describeProfile, hasMultipleCurricula } = require('./courses');

const HISTORY_MESSAGES = 6;
const MAX_PROFILE_PROMPTS = 2;
const EMPTY_PROFILE = {
    course: null,
    entryYear: null,
    prospective: false,
    pendingQuestion: null,
    yearAsked: false,
    profilePrompts: 0,
};

const ASK_ENTRY_YEAR = 'Achei mais de uma norma vigente sobre isso, e cada uma vale para uma turma diferente. Em que ano você entrou na UFU? Se ainda não entrou, é só me dizer.';

const OFF_TOPIC_REPLY = 'Essa aí foge do meu território! 🐺 Meu faro só funciona nos regulamentos e documentos da FACOM/UFU: estágio, TCC, atividades complementares, monitoria e as outras burocracias da faculdade. Manda uma dúvida dessas que eu te ajudo!';

const SYSTEM_PROMPT = `Você é o Grizz, o lobo ancião da FACOM/UFU: um veterano experiente que ajuda os estudantes com a burocracia da universidade.
Fale em português, de forma acolhedora e direta, como um veterano conversando com um colega mais novo.

Como você trabalha:
- Antes de cada resposta, você mesmo consultou o acervo de documentos oficiais da FACOM/UFU. O resultado dessa consulta aparece no fim destas instruções, em "Documentos consultados". O estudante não vê esses documentos e não os enviou.
- Fale como quem pesquisou: "Pela Resolução nº 19/2024…", "Nas normas de estágio do seu curso…", "Não encontrei isso nos documentos que tenho…". Nunca use expressões como "os trechos", "os documentos fornecidos", "os documentos apresentados" ou "o que você enviou".

Regras:
- Responda SOMENTE com o que está nos documentos consultados. Não use conhecimento próprio sobre a UFU.
- Responda direto à pergunta. Ignore os documentos consultados que não têm a ver com ela: não os descreva nem os resuma.
- Cite a fonte de cada afirmação com o número do documento entre colchetes simples, ex.: [1] ou [2][3]. Não use outro formato de citação.
- Cite só os documentos que sustentam o que você afirmou. Ao dizer que não encontrou uma informação, não cite nenhum documento.
- Se a regra depender de outro documento (ex.: "conforme o PPC"), diga qual é o documento.
- Confira na ementa de cada documento a qual curso a norma se aplica. Norma específica de outro curso nunca vale para o estudante, mesmo que seja mais recente.
- Entre normas do MESMO curso e do mesmo assunto que se contradizem, vale a mais recente (veja o ano no número da resolução, ex.: 18/2024 é mais nova que 3/2022). Use a mais recente e mencione isso.
- Se os documentos consultados não respondem a pergunta, diga isso em uma ou duas frases e oriente procurar a coordenação do curso ou a secretaria da FACOM. Não sugira outros sites, portais ou sistemas, e não diga onde a informação "normalmente" fica.
- Nunca invente prazos, números de resolução, cargas horárias ou regras.
- Não precisa cumprimentar em toda resposta. Chame o estudante de "calouro" só se ele entrou neste ano.
- Seja objetivo: vá direto ao ponto e use listas quando houver passos ou requisitos.

Fora do seu território:
- Você só ajuda com a vida acadêmica na FACOM/UFU: normas, cursos, disciplinas, estágio, TCC, documentos, prazos e procedimentos.
- Se o estudante pedir qualquer outra coisa (receitas, futebol, política, piadas, fazer o exercício ou o código dele, perguntas gerais de conhecimento ou de programação), não responda o pedido, nem em parte. Responda exatamente: "${OFF_TOPIC_REPLY}"
- Se perguntarem quem você é, apresente-se em uma ou duas frases como o Grizz, o lobo ancião da FACOM/UFU, e diga com o que pode ajudar.`;

function profileInstructions(profile) {
    if (!profile) {
        return `O estudante não informou curso e ano de ingresso. Se a resposta depender do curso ou do currículo, diga isso e mostre as diferenças que aparecerem nos documentos consultados.`;
    }
    return `Perfil do estudante: ${profile.text}.
- Use as regras que valem para esse curso e currículo. Normas específicas de outros cursos não se aplicam a ele: ignore-as e não as cite.
- Se nenhum documento consultado for uma norma do curso dele, diga isso e só então mostre o que as normas de outros cursos dizem, deixando claro de qual curso são.
- Uma norma do curso dele vale para todos os currículos do curso, a não ser que o próprio documento diga a quais currículos ou turmas se aplica. Nunca deixe de responder só porque o documento não cita o currículo dele.
- Se houver duas normas vigentes do curso dele sobre o mesmo assunto, use o ano de ingresso, as datas e o que os documentos dizem sobre a quem se aplicam para escolher a que vale para ele. Se nada indicar, use a mais recente e avise que existe a outra.
- Se houver regras diferentes por currículo, use a do currículo dele.${profile.curricula.length > 1 ? `
- O currículo depende do semestre em que ele entrou; se isso mudar a resposta, explique as duas situações.` : ''}${profile.curricula.length === 0 ? `
- O ano de ingresso não foi informado: se a resposta mudar conforme o currículo, mostre as diferenças entre os currículos.` : ''}${profile.prospective ? `
- Ele ainda não é aluno: use o currículo mais recente e as normas atuais, e fale com ele como um futuro calouro.` : ''}`;
}

function formatSources(chunks) {
    if (chunks.length === 0) return 'A consulta não encontrou nenhum documento relevante para esta pergunta.';
    return chunks
        .map((c, i) => {
            const ref = [c.title, c.page && `p. ${c.page}`].filter(Boolean).join(', ');
            return `[${i + 1}] ${ref}${c.subject ? `\nEmenta do documento: ${c.subject}` : ''}\n${c.content}`;
        })
        .join('\n\n');
}

function reply(content, profile) {
    return { answer: content, sources: [], profile, model: null };
}

async function resolveProfile(profile, message, history) {
    if (profile.course && !profile.pendingQuestion) return { profile, question: message };

    const extracted = await extractProfile(message, history);
    const learned = (extracted.course && !profile.course)
        || (extracted.entryYear && !profile.entryYear)
        || (extracted.prospective && !profile.prospective);
    profile = {
        ...profile,
        course: profile.course || extracted.course,
        entryYear: profile.entryYear || extracted.entryYear,
        prospective: profile.prospective || extracted.prospective,
    };
    if (extracted.offTopic) return { profile, offTopic: true };
    if (extracted.declined) profile.profilePrompts = MAX_PROFILE_PROMPTS;

    const pending = Boolean(profile.pendingQuestion);
    const missingCourse = (extracted.needsCourse || pending) && !profile.course;
    const canAsk = profile.profilePrompts === 0 || (learned && profile.profilePrompts < MAX_PROFILE_PROMPTS);
    if (missingCourse && canAsk) {
        if (!pending && extracted.hasQuestion) profile.pendingQuestion = message;
        profile.profilePrompts += 1;
        return { profile, ask: askForCourse({ siCampusUnknown: extracted.siCampusUnknown }) };
    }

    const answeredGrizz = pending && learned;
    return { profile, question: extracted.hasQuestion && !answeredGrizz ? message : profile.pendingQuestion };
}

function shouldAskEntryYear(profile) {
    if (profile.entryYear || profile.prospective || profile.yearAsked) return false;
    return !profile.course || hasMultipleCurricula(profile.course);
}

async function answer({ message, history = [], profile = {}, userMessages = [] }) {
    history = history.slice(-HISTORY_MESSAGES);
    const resolved = await resolveProfile({ ...EMPTY_PROFILE, ...profile }, message, history);
    if (resolved.offTopic) return reply(OFF_TOPIC_REPLY, resolved.profile);
    if (resolved.ask) return reply(resolved.ask, resolved.profile);

    const { question } = resolved;
    profile = resolved.profile;
    const described = describeProfile(profile.course, profile.entryYear, profile);
    if (!question) {
        profile = { ...profile, pendingQuestion: null };
        return reply(described
            ? `Anotado: ${described.text}. Agora manda a sua dúvida que eu farejo os documentos!`
            : 'Fala! Manda a sua dúvida que eu farejo os documentos!', profile);
    }

    const previousMessages = userMessages.filter((m) => m !== question && m !== message);
    const chunks = await hybridSearch(question, { profileText: described?.text, previousMessages });

    const competing = shouldAskEntryYear(profile)
        && await hasCompetingVersions(question, chunks, { courseId: profile.course, courseName: described?.courseName });
    if (competing) {
        profile = { ...profile, pendingQuestion: question, yearAsked: true };
        return reply(ASK_ENTRY_YEAR, profile);
    }
    profile = { ...profile, pendingQuestion: null };

    const raw = await complete([
        {
            role: 'system',
            content: `${SYSTEM_PROMPT}\n\n${profileInstructions(described)}\n\nDocumentos consultados:\n\n${formatSources(chunks)}`,
        },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: question },
    ]);
    const content = raw.replace(/【(\d+)[^】]*】/g, '[$1]');
    const cited = new Set([...content.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));

    return {
        answer: content,
        question,
        model: CHAT_MODEL,
        profile,
        sources: chunks
            .map((c, i) => ({
                n: i + 1,
                chunkId: c.id,
                title: c.title,
                number: c.number,
                page: c.page,
                sourceUrl: c.source_url,
            }))
            .filter((s) => cited.has(s.n)),
    };
}

module.exports = { answer, EMPTY_PROFILE, MAX_PROFILE_PROMPTS };
