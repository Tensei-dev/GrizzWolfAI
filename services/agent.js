const { hybridSearch } = require('./search');
const { complete, CHAT_MODEL } = require('./llm');
const { extractProfile, askForCourse, hasCompetingVersions } = require('./profile');
const { describeProfile, hasMultipleCurricula, describeCatalog } = require('./courses');
const { rewriteQuestion } = require('./queryRewriter');
const people = require('./people');
const { COURSES, UNITS, courseOfText } = require('./courses');

const CONTACT_WORDS = /coorden|secretari|contato|e-?mail|telefone|whatsapp|hor[aá]rio de atendimento|atendimento|endere[cç]o|onde fica|sala d/i;

// Contatos dos cursos e das unidades, gerados das páginas dos sites pelo `npm run okf` (services/okfFacts.js).
const FACTS = (() => {
    try {
        return require('../conhecimento/fatos.json');
    } catch {
        return null;
    }
})();

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

const OFF_TOPIC_REPLY = 'Essa aí foge do meu território! 🐺 Meu faro só funciona nos regulamentos e documentos da FACOM e do IME da UFU: estágio, TCC, atividades complementares, monitoria e as outras burocracias da graduação. Manda uma dúvida dessas que eu te ajudo!';

const SYSTEM_PROMPT = `Você é o Grizz, o lobo ancião da FACOM e do IME da UFU: um veterano experiente que ajuda os estudantes com a burocracia da universidade.
Fale em português, de forma acolhedora e direta, como um veterano conversando com um colega mais novo.

Como você trabalha:
- Antes de cada resposta, você mesmo consultou o acervo de documentos oficiais da FACOM (Faculdade de Computação) e do IME (Instituto de Matemática e Estatística) da UFU. O resultado dessa consulta aparece no fim destas instruções, em "Documentos consultados". O estudante não vê esses documentos e não os enviou.
- Fale como quem pesquisou: "Pela Resolução nº 19/2024…", "Nas normas de estágio do seu curso…", "Não encontrei isso nos documentos que tenho…". Nunca use expressões como "os trechos", "os documentos fornecidos", "os documentos apresentados" ou "o que você enviou".

Cursos que você atende (o seu cadastro, não é um documento oficial):
${describeCatalog()}
- Use esta lista para perguntas sobre quais unidades, cursos e currículos você atende (ex.: "quais cursos o IME tem?"). Ela não tem número de citação: não cite [n] para ela.
- Apresente a lista como os cursos de graduação que você atende (ex.: "Os cursos de graduação do IME que eu atendo são…"). Não diga que são todos os cursos da unidade, que é a oferta oficial dela ou que estão em algum documento: a unidade pode ter outros cursos, como os de pós-graduação.
- Para regras, cargas horárias, disciplinas e prazos, a lista não serve: use só os documentos consultados.

Contatos:
- Em "Contatos", no fim destas instruções, estão a coordenação, a secretaria, o horário de atendimento, o e-mail, o telefone e o endereço dos cursos e das unidades, tirados das páginas dos sites. Eles não têm número de citação: não cite [n] para eles; diga que é o que informa o site do curso ou da unidade e, se ajudar, dê o link da página.
- Use-os para perguntas como "quem coordena o curso?", "qual o e-mail da secretaria?" ou "onde fica a coordenação?", e para dizer a quem procurar (com o contato) quando os documentos não responderem.
- Para regras, a lista de contatos não serve.

Normas e páginas dos sites:
- Os documentos consultados são de dois tipos: normas (resoluções, regulamentos, PPCs, fichas) e páginas, notícias e editais dos sites da FACOM e do IME, marcados como "(página do site…)", "(notícia do site…)" ou "(edital…)".
- As páginas servem para informações práticas: contatos, secretarias, coordenação, atendimento, formulários, procedimentos, eventos e oportunidades.
- Em regras (cargas horárias, prazos, requisitos, aproveitamento), vale a norma. Se uma página disser algo diferente de uma norma consultada, siga a norma e avise que a página do site está diferente. Se só uma página trouxer a regra, use-a dizendo que é o que informa o site da unidade.
- Ao usar uma notícia ou edital, diga a data da publicação; prazos e eventos valem para aquela publicação.
- Não complete um procedimento com passos "gerais" ou "comuns" que não estão nos documentos (ex.: etapas de seleção, documentos a entregar). Diga o que a página informa e, para o resto, indique o contato que ela traz.

Pessoas (professores e servidores):
- Quando a pergunta cita alguém pelo nome, os perfis dessa pessoa no site da FACOM ou do IME aparecem entre os documentos consultados, marcados como "Perfil de…". Use-os para dizer quem é a pessoa, o cargo, a titulação, a sala e o telefone, citando o número do perfil.
- Se o perfil diz que a pessoa não está mais em atividade (ex-docente, aposentado), diga isso antes de passar o contato.
- Se vierem vários perfis marcados como "candidatos", a pergunta não deixou claro de quem se trata: liste os nomes e pergunte de qual pessoa o estudante está falando.
- Um perfil não é norma: não tire dele regras, prazos ou quem coordena um curso. Não invente e-mail, telefone ou sala que não estejam no perfil.

Regras:
- Responda SOMENTE com o que está nos documentos consultados, na lista de cursos que você atende e nos contatos. Não use conhecimento próprio sobre a UFU.
- Responda direto à pergunta. Ignore os documentos consultados que não têm a ver com ela: não os descreva nem os resuma.
- Cite a fonte de cada afirmação com o número do documento entre colchetes simples, ex.: [1] ou [2][3]. Não use outro formato de citação.
- Cite só os documentos que sustentam o que você afirmou. Ao dizer que não encontrou uma informação, não cite nenhum documento.
- Se a regra depender de outro documento (ex.: "conforme o PPC"), diga qual é o documento.
- Confira a qual curso cada norma se aplica: use a linha "Vale para" do documento e, se ela não existir, a ementa. Norma específica de outro curso nunca vale para o estudante, mesmo que seja mais recente. Norma de uma unidade (FACOM ou IME) não vale para os cursos da outra.
- Entre normas do MESMO curso e do mesmo assunto que se contradizem, vale a mais recente (veja o ano no número da resolução, ex.: 18/2024 é mais nova que 3/2022). Use a mais recente e mencione isso.
- Se um documento traz "Alterado por", a parte alterada vale como está no documento mais novo: use a regra do documento que alterou e mencione a alteração. Se o documento que alterou não estiver entre os consultados, avise que a norma foi alterada e diga por qual documento.
- A linha "Menciona" lista outros documentos do acervo que a norma cita. Se a resposta depender de um deles e ele não estiver entre os consultados, diga qual é.
- Se os documentos consultados não respondem a pergunta, diga isso em uma ou duas frases e oriente procurar a coordenação do curso ou a secretaria da unidade (FACOM ou IME), com o contato que aparece em "Contatos". Fora as páginas dos contatos, não sugira outros sites, portais ou sistemas, e não diga onde a informação "normalmente" fica.
- Nunca invente prazos, números de resolução, cargas horárias ou regras.
- Não precisa cumprimentar em toda resposta. Chame o estudante de "calouro" só se ele entrou neste ano.
- Seja objetivo: vá direto ao ponto e use listas quando houver passos ou requisitos.

Fora do seu território:
- Você só ajuda com a vida acadêmica na FACOM e no IME da UFU: normas, cursos, disciplinas, estágio, TCC, documentos, prazos e procedimentos.
- Se o estudante pedir qualquer outra coisa (receitas, futebol, política, piadas, fazer o exercício ou o código dele, perguntas gerais de conhecimento, de programação ou de matemática), não responda o pedido, nem em parte. Responda exatamente: "${OFF_TOPIC_REPLY}"
- Se perguntarem quem você é, apresente-se em uma ou duas frases como o Grizz, o lobo ancião da FACOM e do IME da UFU, e diga com o que pode ajudar.`;

function profileInstructions(profile) {
    if (!profile) {
        return `O estudante não informou curso e ano de ingresso. Se a resposta depender do curso ou do currículo, diga isso e mostre as diferenças que aparecerem nos documentos consultados.`;
    }
    return `Perfil do estudante: ${profile.text}. A unidade dele é a ${profile.unitName}: se não encontrar a resposta, oriente procurar a coordenação do curso ou a secretaria da ${profile.unitName}.
- Use as regras que valem para esse curso e currículo. Normas específicas de outros cursos não se aplicam a ele: ignore-as e não as cite.
- Se nenhum documento consultado for uma norma do curso dele, diga isso e só então mostre o que as normas de outros cursos dizem, deixando claro de qual curso são.
- Uma norma do curso dele vale para todos os currículos do curso, a não ser que o próprio documento diga a quais currículos ou turmas se aplica. Nunca deixe de responder só porque o documento não cita o currículo dele.
- Se houver duas normas vigentes do curso dele sobre o mesmo assunto, use o ano de ingresso, as datas e o que os documentos dizem sobre a quem se aplicam para escolher a que vale para ele. Se nada indicar, use a mais recente e avise que existe a outra.
- Se houver regras diferentes por currículo, use a do currículo dele.${profile.curricula.length > 1 ? `
- O currículo depende do semestre em que ele entrou; se isso mudar a resposta, explique as duas situações.` : ''}${profile.curricula.length === 0 ? `
- O ano de ingresso não foi informado: se a resposta mudar conforme o currículo, mostre as diferenças entre os currículos.` : ''}${profile.prospective ? `
- Ele ainda não é aluno: use o currículo mais recente e as normas atuais, e fale com ele como um futuro calouro.` : ''}`;
}

const pageBlock = (p) => `${p.title} (${p.source}):\n${p.fields.map((f) => `- ${f.label}: ${f.value}`).join('\n')}`;
const COORDINATION = /^(coordenador|presidente)/i;

// Com o curso do estudante, vão os contatos completos do curso e da unidade dele; sem o curso, as secretarias das
// unidades e só a coordenação de cada curso, para o prompt não crescer à toa.
function describeContacts(courseId) {
    if (!FACTS) return '';
    const course = courseId && COURSES[courseId];
    const units = course ? [course.unit] : Object.keys(UNITS);
    const parts = units.map((u) => `Unidade ${UNITS[u].name}:\n${(FACTS.unidades[u] || []).map(pageBlock).join('\n')}`);
    if (course) {
        parts.push(`Curso do estudante (${course.name}):\n${(FACTS.cursos[courseId] || []).map(pageBlock).join('\n')}`);
    } else {
        const lines = Object.entries(FACTS.cursos).map(([id, pages]) => {
            const found = pages.flatMap((p) => p.fields.filter((f) => COORDINATION.test(f.label)).map((f) => `${f.label}: ${f.value} (${p.source})`));
            return found.length ? `- ${COURSES[id].name}: ${found.join('; ')}` : null;
        }).filter(Boolean);
        parts.push(`Coordenação de cada curso:\n${lines.join('\n')}`);
    }
    return `\n\nContatos (das páginas dos sites da FACOM e do IME):\n\n${parts.join('\n\n')}`;
}

// Linhas que o grafo de conhecimento acrescenta a cada documento consultado.
function graphLines(graph, numberOf) {
    if (!graph) return '';
    const cite = (d) => (numberOf.has(d.documentId) ? `${d.title} (veja [${numberOf.get(d.documentId)}])` : `${d.title} (não consultado)`);
    return [
        graph.appliesTo.length && `Vale para: ${graph.appliesTo.join('; ')}`,
        graph.alteredBy.length && `Alterado por: ${graph.alteredBy.map(cite).join('; ')}`,
        graph.alters.length && `Altera: ${graph.alters.join('; ')}`,
        graph.cites.length && `Menciona: ${graph.cites.slice(0, 5).join('; ')}`,
    ].filter(Boolean).map((line) => `\n${line}`).join('');
}

// Diz ao modelo o que é cada fonte: as normas mandam; páginas e notícias dos sites completam.
function kindLabel(c) {
    const unit = c.issuer ? ` da ${c.issuer}` : '';
    const date = c.published_at ? new Date(c.published_at).toLocaleDateString('pt-BR') : null;
    if (c.kind === 'pagina') return ` (página do site${unit})`;
    if (c.kind === 'noticia') return ` (notícia do site${unit}${date ? `, publicada em ${date}` : ''})`;
    if (c.kind === 'edital') return ` (edital no site${unit}${date ? `, publicado em ${date}` : ''})`;
    return '';
}

// Os perfis das pessoas citadas vêm antes dos trechos e ficam com os primeiros números: a pergunta é sobre elas,
// e o modelo tende a citar [1] (sobretudo quando o histórico já citou [1]).
function formatPeople(found) {
    if (!found.people.length) return '';
    const note = found.ambiguous ? ' (candidatos: a pergunta não deixa claro de qual pessoa se trata)' : '';
    return `Perfis de pessoas${note}:\n\n` + found.people
        .map((p, i) => `[${i + 1}] ${people.describe(p)}`)
        .join('\n\n');
}

function formatSources(chunks, found = { people: [] }) {
    const offset = found.people.length;
    const profiles = formatPeople(found);
    if (chunks.length === 0) return profiles || 'A consulta não encontrou nenhum documento relevante para esta pergunta.';
    const numberOf = new Map();
    chunks.forEach((c, i) => { if (!numberOf.has(c.document_id)) numberOf.set(c.document_id, offset + i + 1); });
    const excerpts = chunks
        .map((c, i) => {
            const ref = [c.title, c.page && `p. ${c.page}`].filter(Boolean).join(', ') + kindLabel(c);
            return `[${offset + i + 1}] ${ref}${c.subject ? `\nEmenta do documento: ${c.subject}` : ''}${graphLines(c.graph, numberOf)}\n${c.content}`;
        })
        .join('\n\n');
    return profiles ? `${profiles}\n\nDocumentos:\n\n${excerpts}` : excerpts;
}

function reply(content, profile) {
    return { answer: content, sources: [], profile, model: null };
}

async function resolveProfile(profile, message, history, { mentionsPerson = false } = {}) {
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
    // "quem é Renato Aquino?" parecia conhecimento geral para o leitor de perfil; se o nome é de alguém do cadastro
    // da FACOM ou do IME, a pergunta é do território do Grizz.
    if (extracted.offTopic && !mentionsPerson) return { profile, offTopic: true };
    // Quem recusou informar o perfil não é perguntado de novo: nem o curso, nem o ano de ingresso.
    if (extracted.declined) profile = { ...profile, profilePrompts: MAX_PROFILE_PROMPTS, yearAsked: true };

    const pending = Boolean(profile.pendingQuestion);
    // Contato e perfil de uma pessoa não dependem do curso do estudante, nem o contato de um curso que a pergunta já cita
    // ("quem coordena SI de Monte Carmelo?").
    const asksCourseContact = !pending && CONTACT_WORDS.test(message) && Boolean(courseOfText(message));
    const missingCourse = (extracted.needsCourse || pending) && !profile.course && !mentionsPerson && !asksCourseContact;
    const canAsk = profile.profilePrompts === 0 || (learned && profile.profilePrompts < MAX_PROFILE_PROMPTS);
    if (missingCourse && canAsk) {
        if (!pending && extracted.hasQuestion) profile.pendingQuestion = extracted.searchQuery || message;
        profile.profilePrompts += 1;
        return { profile, ask: askForCourse({ ambiguousCourse: extracted.ambiguousCourse }) };
    }

    // A pergunta pendente já foi guardada completa; a mensagem atual vem com a versão reescrita pela leitura do perfil.
    const answeredGrizz = pending && learned;
    if (extracted.hasQuestion && !answeredGrizz) return { profile, question: message, searchQuery: extracted.searchQuery };
    return { profile, question: profile.pendingQuestion, searchQuery: profile.pendingQuestion };
}

// A busca de pessoas não pode derrubar a resposta: sem o cadastro, o Grizz responde só com os documentos.
async function findPeople(...texts) {
    try {
        return await people.findMentioned(...texts);
    } catch (err) {
        console.error(`busca de pessoas indisponível: ${err.message}`);
        return { people: [], ambiguous: false };
    }
}

// O ano de ingresso só escolhe o currículo de um curso conhecido: sem o curso, perguntar o ano não resolve nada.
function shouldAskEntryYear(profile) {
    if (profile.entryYear || profile.prospective || profile.yearAsked) return false;
    return Boolean(profile.course) && hasMultipleCurricula(profile.course);
}

async function answer({ message, history = [], profile = {} }) {
    history = history.slice(-HISTORY_MESSAGES);
    const named = await findPeople(message);
    const resolved = await resolveProfile({ ...EMPTY_PROFILE, ...profile }, message, history, { mentionsPerson: named.people.length > 0 });
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

    const searchQuery = resolved.searchQuery || await rewriteQuestion(question, history);
    const [chunks, found] = await Promise.all([
        hybridSearch(searchQuery, { profile: described, originalQuestion: question }),
        // a versão reescrita resolve "e o ramal dele?" para o nome citado antes na conversa
        named.people.length && question === message ? named : findPeople(question, searchQuery),
    ]);

    const competing = shouldAskEntryYear(profile)
        && await hasCompetingVersions(searchQuery, chunks.filter((c) => c.kind === 'norma'), { courseId: profile.course, courseName: described?.courseName });
    if (competing) {
        profile = { ...profile, pendingQuestion: searchQuery, yearAsked: true };
        return reply(ASK_ENTRY_YEAR, profile);
    }
    profile = { ...profile, pendingQuestion: null };

    const raw = await complete([
        {
            role: 'system',
            content: `${SYSTEM_PROMPT}\n\n${profileInstructions(described)}${describeContacts(profile.course)}\n\nDocumentos consultados:\n\n${formatSources(chunks, found)}`,
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
        sources: found.people
            .map((p, i) => ({
                n: i + 1,
                chunkId: null,
                title: `Perfil: ${p.nome} (${p.unidade.toUpperCase()})`,
                number: null,
                page: null,
                sourceUrl: p.source_url,
            }))
            .concat(chunks.map((c, i) => ({
                n: found.people.length + i + 1,
                chunkId: c.id,
                title: c.title,
                number: c.number,
                page: c.page,
                sourceUrl: c.source_url,
            })))
            .filter((s) => cited.has(s.n)),
    };
}

module.exports = { answer, EMPTY_PROFILE, MAX_PROFILE_PROMPTS };
