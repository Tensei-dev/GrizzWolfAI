const { hybridSearch } = require('./search');
const { complete, CHAT_MODEL } = require('./llm');
const { extractProfile, askForProfile } = require('./profile');
const { describeProfile } = require('./courses');

const HISTORY_MESSAGES = 6; // últimas mensagens da conversa enviadas ao modelo
const MAX_PROFILE_PROMPTS = 2; // depois disso o Grizz responde mesmo sem o perfil completo
const EMPTY_PROFILE = { course: null, entryYear: null, pendingQuestion: null, profilePrompts: 0 };

const SYSTEM_PROMPT = `Você é o Grizz, o lobo ancião da FACOM/UFU: um veterano experiente que ajuda calouros com a burocracia da universidade.
Fale em português, de forma acolhedora e direta, como um veterano conversando com um calouro.

Regras:
- Responda SOMENTE com base nos trechos de documentos oficiais fornecidos. Não use conhecimento próprio sobre a UFU.
- Os trechos vêm da sua própria busca nos documentos, não do estudante: nunca diga que ele os enviou.
- Cite a fonte de cada afirmação com o número do trecho entre colchetes simples, ex.: [1] ou [2][3]. Não use outro formato de citação.
- Se a regra depender de outro documento (ex.: "conforme o PPC"), diga qual é o documento.
- Confira na ementa de cada trecho a qual curso a norma se aplica. Norma específica de outro curso nunca vale para o estudante, mesmo que seja mais recente.
- Entre normas do MESMO curso e do mesmo assunto que se contradizem, vale a mais recente (veja o ano no número da resolução, ex.: 18/2024 é mais nova que 3/2022). Use a mais recente e mencione isso.
- Se os trechos não respondem a pergunta, diga isso com honestidade e sugira procurar a coordenação do curso ou a secretaria da FACOM. Nunca invente prazos, números de resolução ou regras.
- Seja objetivo: vá direto ao ponto e use listas quando houver passos ou requisitos.`;

function profileInstructions(profile) {
    if (!profile) {
        return `O estudante não informou curso e ano de ingresso. Se a resposta depender do curso ou do currículo, diga isso e mostre as diferenças que aparecerem nos trechos.`;
    }
    return `Perfil do estudante: ${profile.text}.
- Use as regras que valem para esse curso e currículo. Trechos de normas de outros cursos não se aplicam a ele: ignore-os e não os cite.
- Se nenhum trecho for de uma norma do curso dele, diga isso e só então mostre o que as normas de outros cursos dizem, deixando claro de qual curso são.
- Se houver regras diferentes por currículo nos trechos, use a do currículo dele.${profile.curricula.length > 1 ? `
- O currículo depende do semestre em que ele entrou; se isso mudar a resposta, explique as duas situações.` : ''}`;
}

function formatSources(chunks) {
    if (chunks.length === 0) return 'Nenhum trecho relevante foi encontrado.';
    return chunks
        .map((c, i) => {
            const ref = [c.title, c.page && `p. ${c.page}`].filter(Boolean).join(', ');
            return `[${i + 1}] ${ref}${c.subject ? `\nEmenta do documento: ${c.subject}` : ''}\n${c.content}`;
        })
        .join('\n\n');
}

// resposta fixa do Grizz, sem busca nem fontes
function reply(content, profile) {
    return { answer: content, sources: [], profile, model: null };
}

// decide o que responder: pede o perfil se faltar algo, ou devolve a pergunta a ser
// respondida (pode ser a que ficou pendente enquanto o Grizz pedia o perfil)
async function resolveProfile(profile, message, history) {
    if (profile.course && profile.entryYear) return { profile, question: message };

    const extracted = await extractProfile(message, history);
    profile = {
        ...profile,
        course: profile.course || extracted.course,
        entryYear: profile.entryYear || extracted.entryYear,
    };

    // recusar uma vez basta: o Grizz responde sem o perfil e não pergunta de novo
    if (extracted.declined) profile.profilePrompts = MAX_PROFILE_PROMPTS;
    const complete = profile.course && profile.entryYear;
    if (!complete && profile.profilePrompts < MAX_PROFILE_PROMPTS) {
        profile.pendingQuestion = profile.pendingQuestion || (extracted.hasQuestion ? message : null);
        profile.profilePrompts += 1;
        return {
            profile,
            ask: askForProfile({ course: profile.course, entryYear: profile.entryYear, siCampusUnknown: extracted.siCampusUnknown }),
        };
    }

    // perfil completo (ou o aluno não quis informar): responde a dúvida atual ou a pendente
    return { profile, question: extracted.hasQuestion ? message : profile.pendingQuestion };
}

// responde uma mensagem sem guardar nada: a conversa fica no navegador do aluno, que envia
// as últimas mensagens (history) e o perfil a cada pergunta e recebe o perfil atualizado.
// profile: { course, entryYear, pendingQuestion, profilePrompts }
async function answer({ message, history = [], profile = {} }) {
    history = history.slice(-HISTORY_MESSAGES);
    const resolved = await resolveProfile({ ...EMPTY_PROFILE, ...profile }, message, history);
    if (resolved.ask) return reply(resolved.ask, resolved.profile);

    const { question } = resolved;
    // a pergunta pendente é respondida agora; se algo falhar, o navegador mantém o perfil antigo
    profile = { ...resolved.profile, pendingQuestion: null };
    const described = describeProfile(profile.course, profile.entryYear);
    if (!question) {
        const noted = described ? `Anotado: ${described.text}. ` : '';
        return reply(`${noted}Agora manda a sua dúvida que eu farejo os documentos!`, profile);
    }

    const chunks = await hybridSearch(question, { profileText: described?.text });

    const raw = await complete([
        { role: 'system', content: `${SYSTEM_PROMPT}\n\n${profileInstructions(described)}` },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: `Trechos dos documentos oficiais:\n\n${formatSources(chunks)}\n\nPergunta: ${question}` },
    ]);
    // os modelos gpt-oss às vezes citam no formato próprio deles: 【1†L1-L4】 -> [1]
    const content = raw.replace(/【(\d+)[^】]*】/g, '[$1]');

    return {
        answer: content,
        question,
        model: CHAT_MODEL,
        profile,
        // n é o número usado nas citações [n] da resposta
        sources: chunks.map((c, i) => ({
            n: i + 1,
            chunkId: c.id,
            title: c.title,
            number: c.number,
            page: c.page,
            sourceUrl: c.source_url,
        })),
    };
}

module.exports = { answer, EMPTY_PROFILE, MAX_PROFILE_PROMPTS };
