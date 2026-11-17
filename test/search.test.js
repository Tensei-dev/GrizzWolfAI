// Regras da busca e do grafo que corrigiram respostas erradas. Sem banco nem LLM.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pick, reciprocalRankFusion } = require('../services/search');
const { curriculumYear, isExtinctCurriculum } = require('../services/knowledgeGraph');
const { courseOfText } = require('../services/courses');
const { clientIp } = require('../services/rateLimit');

const norma = (id, documentId = id) => ({ id, document_id: documentId, kind: 'norma' });
const pagina = (id, documentId) => ({ id, document_id: documentId, kind: 'pagina' });

test('no máximo 2 trechos de páginas, e um por página', () => {
    // a resposta da empresa júnior trazia a ASCII duas vezes e deixava a TechMob de fora
    const ranked = [pagina(1, 336), pagina(2, 336), pagina(3, 335), pagina(4, 400), norma(5), norma(6)];
    assert.deepEqual(pick(ranked, 5).map((c) => c.id), [1, 3, 5, 6]);
});

test('as normas preenchem as vagas na ordem do rerank', () => {
    const ranked = [norma(1), norma(2), norma(3), norma(4), norma(5), norma(6)];
    assert.deepEqual(pick(ranked, 5).map((c) => c.id), [1, 2, 3, 4, 5]);
});

test('fusão RRF soma as posições das listas', () => {
    const fused = reciprocalRankFusion([[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]]);
    assert.equal(fused[0].id, 'b');
});

test('ano do currículo citado no título', () => {
    assert.equal(curriculumYear('Normas de Estágio (Currículo 10/97)'), 1997);
    assert.equal(curriculumYear('Projeto Pedagógico BCC – Currículo 2010-2'), 2010);
    assert.equal(curriculumYear('Fichas de Disciplina - Currículo 2023-1'), 2023);
    assert.equal(curriculumYear('Resolução nº 3/2022'), null);
});

test('norma de currículo mais antigo que os do cadastro é de currículo extinto', () => {
    // a norma de estágio do currículo 10/97 aparecia para quem entrou em 2023
    assert.equal(isExtinctCurriculum('Estágio Supervisionado do Curso de Ciência da Computação (Currículo 10/97)', 'bcc'), true);
    assert.equal(isExtinctCurriculum('Estágio Supervisionado do Curso de Ciência da Computação (Currículo 2010)', 'bcc'), false);
    assert.equal(isExtinctCurriculum('Resolução nº 18/2024, do Conselho da FACOM', 'bcc'), false);
});

test('curso citado na pergunta', () => {
    assert.equal(courseOfText('Quem coordena o curso de Sistemas de Informação de Monte Carmelo?'), 'bsi-mc');
    assert.equal(courseOfText('Como funciona o estágio em Ciência da Computação?'), 'bcc');
    assert.equal(courseOfText('Qual o e-mail da coordenação?'), null);
});

test('IP do visitante: fora da Vercel, x-forwarded-for do cliente não vale', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '::1' } };
    const saved = process.env.VERCEL;
    delete process.env.VERCEL;
    assert.equal(clientIp(req), '::1');
    assert.equal(clientIp({ headers: { 'x-vercel-forwarded-for': '5.6.7.8, 9.9.9.9' }, socket: {} }), '5.6.7.8');
    if (saved !== undefined) process.env.VERCEL = saved;
});

test('candidatos ao rerank: no máximo 4 trechos do mesmo documento', () => {
    const { diversify } = require('../services/search');
    // as duas resoluções de estágio enchiam as 12 vagas, e a ficha com as 160 h ficava de fora
    const fused = [...Array(10)].map((_, i) => norma(i, 29)).concat([...Array(10)].map((_, i) => norma(100 + i, 37)), [norma(200, 66)]);
    const chosen = diversify(fused, 12);
    assert.equal(chosen.filter((c) => c.document_id === 29).length, 4);
    assert.ok(chosen.some((c) => c.document_id === 66));
});

test('e-mail que não estava no contexto sai da resposta', () => {
    const { withoutUnknownEmails } = require('../services/guards');
    const context = 'Secretário: Gabriel Firme da Fonseca · facom@ufu.br\nE-mail: ralopes@ufu.br';
    const answer = 'Fale com a secretaria (gabriel.firme@ufu.br ou facom@ufu.br) ou com RALOPES@ufu.br.';
    assert.equal(withoutUnknownEmails(answer, context), 'Fale com a secretaria (e-mail não informado no site ou facom@ufu.br) ou com RALOPES@ufu.br.');
});
