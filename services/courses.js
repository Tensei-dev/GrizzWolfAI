const UNITS = {
    facom: { name: 'FACOM', fullName: 'Faculdade de Computação' },
    ime: { name: 'IME', fullName: 'Instituto de Matemática e Estatística' },
};

const COURSES = {
    bcc: {
        unit: 'facom',
        name: 'Bacharelado em Ciência da Computação',
        pattern: /ci[eê]ncia da computa[cç][aã]o/i,
        curricula: [
            { name: '2010-2', startYear: 2010, startSemester: 2 },
            { name: '2023-1', startYear: 2023, startSemester: 1 },
        ],
    },
    bsi: {
        unit: 'facom',
        name: 'Bacharelado em Sistemas de Informação (campus Santa Mônica, Uberlândia)',
        pattern: /sistemas de informa[cç][aã]o/i,
        curricula: [
            { name: '2009-1', startYear: 2009, startSemester: 1 },
            { name: '2016-1', startYear: 2016, startSemester: 1 },
            { name: '2022-2', startYear: 2022, startSemester: 2 },
        ],
    },
    'bsi-mc': {
        unit: 'facom',
        name: 'Bacharelado em Sistemas de Informação (campus Monte Carmelo)',
        pattern: /monte carmelo/i,
        curricula: [
            { name: '2016', startYear: 2016, startSemester: 1 },
            { name: '2022', startYear: 2022, startSemester: 2 },
        ],
    },
    bia: {
        unit: 'facom',
        name: 'Bacharelado em Inteligência Artificial',
        pattern: /intelig[eê]ncia artificial/i,
        curricula: [{ name: 'único (curso criado em 2025)', startYear: 2025, startSemester: 1 }],
    },
    'mat-bach': {
        unit: 'ime',
        name: 'Bacharelado em Matemática',
        pattern: /bacharelado em matem[aá]tica|matem[aá]tica,? (grau )?bacharelado|^bacharelado\b/i,
        curricula: [
            { name: '2011', startYear: 2011, startSemester: 1 },
            { name: '2018', startYear: 2018, startSemester: 1 },
        ],
    },
    'mat-lic': {
        unit: 'ime',
        name: 'Licenciatura em Matemática (presencial)',
        pattern: /licenciatura/i,
        curricula: [
            { name: '2011', startYear: 2011, startSemester: 1 },
            { name: '2018', startYear: 2018, startSemester: 1 },
        ],
    },
    'mat-ead': {
        unit: 'ime',
        name: 'Licenciatura em Matemática a distância (EaD)',
        pattern: /matem[aá]tica,?\s*(ead|grau licenciatura,? modalidade a dist[aâ]ncia)|licenciatura em matem[aá]tica a dist[aâ]ncia|\bead\b/i,
        curricula: [
            { name: 'turma 1', startYear: 2010, startSemester: 1 },
            { name: 'turma 2', startYear: 2017, startSemester: 1 },
            { name: 'turma 3', startYear: 2021, startSemester: 1 },
            { name: 'turma 4', startYear: 2025, startSemester: 1 },
        ],
    },
    estat: {
        unit: 'ime',
        name: 'Bacharelado em Ciência de Dados e Estatística (antigo Bacharelado em Estatística)',
        pattern: /ci[eê]ncia de dados|bacharelado em estat[ií]stica|curso de (gradua[cç][aã]o em )?estat[ií]stica/i,
        curricula: [
            { name: '2016-1', startYear: 2016, startSemester: 1 },
            { name: '2026-1', startYear: 2026, startSemester: 1 },
        ],
    },
};

// Ordem de teste dos padrões: os mais específicos primeiro.
const PATTERN_ORDER = ['bia', 'bsi-mc', 'bsi', 'bcc', 'mat-ead', 'estat', 'mat-lic', 'mat-bach'];

function courseOfText(text, unit = null) {
    return PATTERN_ORDER.find((id) => (!unit || COURSES[id].unit === unit) && COURSES[id].pattern.test(text)) || null;
}

function curriculumFor(courseId, entryYear) {
    const course = COURSES[courseId];
    if (!course || !entryYear) return [];

    const applicable = course.curricula.filter((c) => c.startYear <= entryYear);
    const latest = applicable[applicable.length - 1];
    if (!latest) return [course.curricula[0]];

    const previous = applicable[applicable.length - 2];
    if (latest.startYear === entryYear && latest.startSemester === 2 && previous) return [previous, latest];
    return [latest];
}

function hasMultipleCurricula(courseId) {
    return (COURSES[courseId]?.curricula.length || 0) > 1;
}

function describeProfile(courseId, entryYear, { prospective = false } = {}) {
    const course = COURSES[courseId];
    if (!course) return null;
    const latest = course.curricula[course.curricula.length - 1];

    let when = null;
    let curricula = [];
    if (prospective) {
        when = 'ainda não ingressou, está pensando em cursar';
        curricula = [latest.name];
    } else if (entryYear) {
        when = `ingresso em ${entryYear}`;
        curricula = curriculumFor(courseId, entryYear).map((c) => c.name);
    } else if (!hasMultipleCurricula(courseId)) {
        curricula = [latest.name];
    } else {
        when = 'ano de ingresso não informado';
    }

    const curriculumText = curricula.length > 1
        ? `currículo ${curricula.join(' ou ')} (depende do semestre de ingresso)`
        : curricula.length ? `currículo ${curricula[0]}` : null;
    const unit = UNITS[course.unit];
    const text = [`${course.name} (${unit.name})`, when, curriculumText].filter(Boolean).join(', ');
    return { courseId, courseName: course.name, unit: course.unit, unitName: unit.name, entryYear, prospective, curricula, text };
}

module.exports = { UNITS, COURSES, courseOfText, curriculumFor, hasMultipleCurricula, describeProfile };
