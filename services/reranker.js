const { complete, RERANK_MODEL } = require('./llm');

const MAX_PASSAGE_CHARS = 700;
const MIN_SCORE = 2; // abaixo disso o trecho é descartado, mesmo que sobre espaço no topK

const SYSTEM_PROMPT = `Você avalia a relevância de trechos de documentos oficiais da UFU para a pergunta de um estudante.
Dê a cada trecho uma nota de 0 a 10:
10 = responde diretamente a pergunta; 5 = relacionado, mas não responde; 0 = irrelevante.
Se o perfil do estudante for informado, trechos de normas específicas de OUTRO curso valem no máximo 1.
O curso de cada norma costuma aparecer na ementa, depois do título (ex.: "Aprova as Normas de Estágio ... do curso de ...").
Responda só com JSON no formato {"scores": [{"id": 1, "score": 7}, ...]}, com uma entrada para cada trecho.`;

// candidates: [{ id, title, content, ... }] -> os mesmos objetos com rerankScore, do mais relevante ao menos
async function rerank(question, candidates, { topK = 5, profileText = null } = {}) {
    if (candidates.length === 0) return [];

    const passages = candidates
        .map((c, i) => `[${i + 1}] (${[c.title, c.subject].filter(Boolean).join(' — ')})\n${c.content.slice(0, MAX_PASSAGE_CHARS)}`)
        .join('\n\n');

    let scores;
    try {
        const raw = await complete(
            [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `${profileText ? `Perfil do estudante: ${profileText}\n` : ''}Pergunta: ${question}\n\nTrechos:\n\n${passages}`,
                },
            ],
            { model: RERANK_MODEL, temperature: 0, json: true, reasoningEffort: 'low' }
        );
        scores = JSON.parse(raw).scores;
    } catch (err) {
        // se o rerank falhar, a ordem da fusão já é uma boa ordem
        console.error(`rerank falhou, usando a ordem da fusão: ${err.message}`);
        return candidates.slice(0, topK);
    }

    const byIndex = new Map(scores.map((s) => [Number(s.id), Number(s.score)]));
    return candidates
        .map((c, i) => ({ ...c, rerankScore: byIndex.get(i + 1) ?? 0 }))
        .filter((c) => c.rerankScore >= MIN_SCORE)
        // empate na nota mantém a ordem da fusão (sort é estável)
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .slice(0, topK);
}

module.exports = { rerank };
