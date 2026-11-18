const test = require('node:test');
const assert = require('node:assert/strict');
const { mentioned, words, describe } = require('../services/people');

function registry(names) {
    const people = names.map(([nome, situacao = 'Em exercício'], id) => ({ id, nome, situacao, unidade: 'facom', parts: [...new Set(words(nome))] }));
    const frequency = new Map();
    for (const p of people) for (const w of p.parts) frequency.set(w, (frequency.get(w) || 0) + 1);
    return { people, frequency };
}

const cadastro = registry([
    ['Adriano Mendonça Rocha'], ['Adriano Barbosa Silva', 'Ex-docente'], ['Rosana Sueli Da Motta Jafelice'],
    ['Marcelo de Almeida Maia'], ['Marcelo Keese Albertini'], ['Marcelo Tavares'], ['Maria da Silva'], ['José da Silva'],
    ['João Silva'],
    ...['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Hugo', 'Iara'].map((n) => [`${n} Pereira Silva`]),
]);
const names = (text) => mentioned(text, cadastro).people.map((p) => p.nome);

test('acha a pessoa por duas partes do nome, sem acento', () => {
    assert.deepEqual(names('Qual o telefone do professor Adriano Rocha?'), ['Adriano Mendonça Rocha']);
    assert.deepEqual(names('quem e a professora rosana jafelice'), ['Rosana Sueli Da Motta Jafelice']);
});

test('nome completo fica na frente dos outros com partes iguais', () => {
    assert.equal(names('ramal do Adriano Barbosa Silva')[0], 'Adriano Barbosa Silva');
});

test('uma parte rara do nome só conta junto de uma palavra de pessoa', () => {
    assert.deepEqual(names('qual a sala da professora Jafelice'), ['Rosana Sueli Da Motta Jafelice']);
    assert.deepEqual(names('Jafelice'), []);
});

test('nome comum vira lista de candidatos; sobrenome muito comum sozinho não acha ninguém', () => {
    const found = mentioned('Quero falar com o professor Marcelo', cadastro);
    assert.equal(found.people.length, 3);
    assert.equal(found.ambiguous, true);
    assert.deepEqual(names('Quero falar com o Silva'), []);
});

test('pergunta sobre normas não traz ninguém', () => {
    assert.deepEqual(names('Qual a carga horária de estágio do BCC?'), []);
    assert.deepEqual(names('Telefone da secretaria em Monte Carmelo'), []);
});

test('perfil de quem saiu avisa que a pessoa não está mais em atividade', () => {
    const text = describe({ nome: 'Adriano Barbosa Silva', unidade: 'facom', situacao: 'Ex-docente', telefone: '+55 34 3239-4576', ramal: '4576' });
    assert.match(text, /não está mais em atividade na FACOM/);
    assert.match(text, /ramal 4576/);
});
