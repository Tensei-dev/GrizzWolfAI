// Quem dá cada disciplina (services/teaching.js), com trechos dos horários reais e um cadastro de mentira: sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimetable, resolvePerson, semesterOf, unitOfCode, splitNames } = require('../services/teaching');

const people = [
    { id: 1, nome: 'Murillo Guimarães Carneiro', unidade: 'facom', situacao: 'Em exercício' },
    { id: 2, nome: 'Renato de Aquino Lopes', unidade: 'facom', situacao: 'Em exercício' },
    { id: 3, nome: 'Rosana Sueli Da Motta Jafelice', unidade: 'ime', situacao: 'Em exercício' },
    { id: 4, nome: 'Gustavo de Lima Prado', unidade: 'ime', situacao: 'Em exercício' },
    { id: 5, nome: 'Daniel Duarte Abdala', unidade: 'facom', situacao: 'Em exercício', endereco: 'Campus Santa Mônica - Bloco 1B' },
    { id: 6, nome: 'Daniel Stefany Duarte Caetano', unidade: 'facom', situacao: 'Em exercício', endereco: 'Campus Monte Carmelo - Bloco 1A' },
    { id: 7, nome: 'Sarah Faria Monteiro Mazzini Costa', unidade: 'ime', situacao: 'Em exercício' },
    { id: 8, nome: 'Edmilson Rodrigues Pinto', unidade: 'ime', situacao: 'Em exercício' },
];

test('SIGAA: código, disciplina, turma, docente e horários; trechos repetidos contam uma vez', () => {
    const text = [
        'Turma: D Período: 2° Semestre de 2026',
        'Estrutura Curricular: Disciplinas Obrigatórias',
        'FACOM34101 - Fundamentos de Inteligência Artificial Docentes: Murillo Guimarães Carneiro',
        'Horários: Segunda-feira 10:40:00 às 12:20:00 - Teórica Início: 01/09/2026 Fim: 19/12/2026 CH Ofertada:. 2 Sala: 1B 110 Capacidade: 80',
        // a sobreposição dos trechos repete o bloco
        'FACOM34101 - Fundamentos de Inteligência Artificial Docentes: Murillo Guimarães Carneiro',
        'Horários: Sexta-feira 10:40:00 às 12:20:00 - Teórica Início: 01/09/2026 Fim: 19/12/2026 CH Ofertada:. 2 Sala: 1B 204 Capacidade: 80',
        '60 CH Total: CH Téorica: 60 CH Prática: 0 Período Ideal: 1',
        'FACOM31805 - Estágio Supervisionado Docentes:',
    ].join('\n');
    const rows = parseTimetable(text, people);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
        codigo: 'FACOM34101', disciplina: 'Fundamentos de Inteligência Artificial', turma: 'D', docentes: ['Murillo Guimarães Carneiro'],
        horarios: ['Segunda-feira 10:40–12:20 (sala 1B 110)', 'Sexta-feira 10:40–12:20 (sala 1B 204)'],
    });
    assert.deepEqual(rows[1].docentes, []);
    assert.equal(semesterOf('Horários de Aula - Período Letivo 2026/1 - ... 2026/2', text), '2026/2');
});

test('SIGAA com as colunas trocadas: o nome do cadastro no fim da linha separa disciplina e docente', () => {
    const [row] = parseTimetable('Docentes: GES030 - Inferência Bayesiana Edmilson Rodrigues Pinto', people);
    assert.equal(row.disciplina, 'Inferência Bayesiana');
    assert.deepEqual(row.docentes, ['Edmilson Rodrigues Pinto']);
});

test('legendas das grades: com sala, entre parênteses, e sem tomar sala ou sigla por nome', () => {
    const rows = parseTimetable([
        'AL1 - FAMAT31302 - Álgebra Linear I - Rosana (Sala: 5S 301)',
        'PI2 - FAMAT31706 - Projeto Integrado de Prática Educativa - PROINTER II - Érika (Sala: 1F129)',
        'GSI517 – Estatística (Vânia/Jair)',
        'GSI509 – Profissão em Sistemas de Informação (Sarah Substituta)',
        'FAMAT39114 – Mat. Discreta (T)',
        'LEM1 - FAMAT31501 - Laboratório de Ensino de Matemática (LEM)',
    ].join('\n'));
    assert.deepEqual(rows.map((r) => [r.codigo, r.docentes]), [
        ['FAMAT31302', ['Rosana']],
        ['FAMAT31706', ['Érika']],
        ['GSI517', ['Vânia', 'Jair']],
        ['GSI509', ['Sarah (substituta)']],
    ]);
    assert.equal(rows[0].horarios[0], 'sala 5S 301');
    assert.deepEqual(splitNames('Rogério - Substituto'), ['Rogério (substituto)']);
});

test('ligação ao cadastro: nome completo em qualquer unidade; nome curto na unidade da disciplina, com o campus no empate', () => {
    assert.equal(resolvePerson('Edmilson Rodrigues Pinto', people, { unit: 'facom' })?.id, 8);
    assert.equal(resolvePerson('Rosana', people, { unit: unitOfCode('FAMAT31302') })?.id, 3);
    assert.equal(resolvePerson('Gustavo', people, { unit: unitOfCode('FAMAT39114') })?.id, 4);
    assert.equal(resolvePerson('Gustavo', people, { unit: 'facom' }), null);
    assert.equal(resolvePerson('Daniel', people, { unit: 'facom' }), null);
    assert.equal(resolvePerson('Daniel', people, { unit: 'facom', campus: 'Monte Carmelo' })?.id, 6);
    // substituto não é ligado pelo primeiro nome, mesmo havendo uma Sarah no cadastro
    assert.equal(resolvePerson('Sarah (substituta)', people, { unit: 'ime' }), null);
    assert.equal(unitOfCode('IERI39202'), null);
});
