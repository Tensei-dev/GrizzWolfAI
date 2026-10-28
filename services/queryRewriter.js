const { complete, RERANK_MODEL } = require('./llm');

// A busca usa só a pergunta atual, reescrita como pergunta completa. O histórico serve para resolver referências
// ("e o prazo?") sem arrastar para a busca os assuntos anteriores da conversa.

const REWRITE_RULES = `Reescreva a mensagem atual do estudante como uma pergunta completa e independente, para buscar em documentos oficiais da UFU.
- Use o histórico só para entender referências da mensagem atual (ex.: "e o prazo?", "e para quem já fez?", "isso vale no noturno?").
- Não inclua assuntos anteriores que a mensagem atual não retoma.
- Não responda a pergunta e não acrescente curso nem ano de ingresso do estudante.
- Mantenha termos exatos: números de resoluções, nomes e códigos de disciplinas, siglas.
- Se a mensagem atual já é uma pergunta completa, repita-a.`;

const SYSTEM_PROMPT = `${REWRITE_RULES}\nResponda só com JSON no formato {"query": "<pergunta completa>"}.`;

const HISTORY_MESSAGES = 4;
const MAX_QUERY_CHARS = 500;

function formatHistory(history) {
    return history
        .slice(-HISTORY_MESSAGES)
        .map((m) => `${m.role === 'user' ? 'Estudante' : 'Grizz'}: ${m.content}`)
        .join('\n');
}

function validQuery(value) {
    return typeof value === 'string' && value.trim() && value.length <= MAX_QUERY_CHARS ? value.trim() : null;
}

// Sem o modelo, a melhor aposta é a pergunta atual com a mensagem anterior do estudante, não a conversa toda.
function fallbackQuery(question, history) {
    const previous = [...history].reverse().find((m) => m.role === 'user' && m.content !== question);
    return previous ? `${previous.content}\n${question}` : question;
}

async function rewriteQuestion(question, history = []) {
    if (history.length === 0) return question;
    try {
        const raw = await complete(
            [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Histórico:\n${formatHistory(history)}\n\nMensagem atual do estudante: ${question}` },
            ],
            { model: RERANK_MODEL, temperature: 0, json: true, reasoningEffort: 'low' }
        );
        return validQuery(JSON.parse(raw).query) || fallbackQuery(question, history);
    } catch (err) {
        console.error(`reescrita da pergunta falhou, usando a pergunta com a mensagem anterior: ${err.message}`);
        return fallbackQuery(question, history);
    }
}

module.exports = { REWRITE_RULES, rewriteQuestion, validQuery };
