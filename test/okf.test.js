// Pacote OKF: classificação das páginas, contatos fixos e corte por seções. Sem rede nem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const okf = require('../services/okf');
const { contactFields } = require('../services/okfFacts');
const { chunkMarkdown } = require('../services/chunker');

test('páginas soltas do portal com cara de edital viram edital; as outras continuam página', () => {
    assert.equal(okf.typeOf('node', 'Edital de Monitoria BSI- VAGAS REMANESCENTES'), 'edital');
    assert.equal(okf.typeOf('node', 'Eleições FACOM/UFU - Edital FACOM nº. 01/2019'), 'edital');
    assert.equal(okf.typeOf('node', 'AWC 2019 - Programa de Aceleração de TCCs'), 'edital');
    assert.equal(okf.typeOf('node', 'Quadro para dispensas/equivalências'), 'pagina');
    assert.equal(okf.typeOf('acontece', 'Qualquer coisa'), 'noticia');
    assert.equal(okf.typeOf('pessoas', 'Fulano'), 'pessoa');
});

test('saem do pacote as páginas de teste e os editais vencidos', () => {
    const cutoff = '2026-08-19';
    assert.equal(okf.staleReason({ title: 'Teste Contato', secao: 'node', type: 'pagina' }, cutoff), 'página de teste do portal');
    assert.match(okf.staleReason({ title: 'Resultado Monitoria BSI 2025/2', secao: 'node', type: 'pagina', publicado: '2025-08-01' }, cutoff), /90 dias/);
    assert.equal(okf.staleReason({ title: 'Ajustes de matrícula', secao: 'node', type: 'pagina', publicado: '2018-11-14' }, cutoff), null);
    assert.equal(okf.staleReason({ title: 'Projeto Meninas na Computação', secao: 'acontece', type: 'noticia', publicado: '2026-09-15' }, cutoff), null);
});

test('contatos: rótulo em negrito e as linhas de baixo, sem links e sem os campos que não interessam', () => {
    const body = [
        '**Horário de atendimento:** Segunda a sexta, 8h às 17h',
        '',
        '**Coordenador:** [Renato de Aquino Lopes](https://facom.ufu.br/pessoas/docentes/renato)',
        '',
        '[cocom@ufu.br](mailto:cocom@ufu.br)',
        '',
        '+55 34 3239-4218 **R:**4218',
        '',
        '**Representante Discente:** [Fulano](https://x)',
        '',
        'email-do-representante@ufu.br',
        '',
        '-   [YouTube](https://youtube.com/x)',
        '',
        '**Endereço:** Campus Santa Mônica - Bloco 1B',
        'Uberlândia - MG',
    ].join('\n');
    assert.deepEqual(contactFields(body), [
        { label: 'Horário de atendimento', value: 'Segunda a sexta, 8h às 17h' },
        { label: 'Coordenador', value: 'Renato de Aquino Lopes · cocom@ufu.br · +55 34 3239-4218 ramal 4218' },
        { label: 'Endereço', value: 'Campus Santa Mônica - Bloco 1B · Uberlândia - MG' },
    ]);
});

test('corte por seções: cada trecho leva o caminho de títulos e fica sem os links internos', () => {
    const md = [
        '# Estágio', '', 'Introdução.', '', '## Documentos', '', 'Veja o [modelo](../servicos/modelo.md).',
        '', '### Termo', '', 'Assine o termo.',
    ].join('\n');
    const chunks = chunkMarkdown(md, 'Estágio Supervisionado');
    const headings = chunks.map((c) => c.heading);
    assert.ok(headings.includes('Estágio Supervisionado › Documentos'));
    assert.ok(headings.includes('Estágio Supervisionado › Documentos › Termo'));
    const docs = chunks.find((c) => c.heading === 'Estágio Supervisionado › Documentos');
    assert.match(docs.content, /Veja o modelo/);
    assert.doesNotMatch(docs.content, /\.md\)/);
});
