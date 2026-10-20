const COURSES = {
    bcc: {
        name: 'Bacharelado em Ciência da Computação',
        curricula: [
            { name: '2010-2', startYear: 2010, startSemester: 2 },
            { name: '2023-1', startYear: 2023, startSemester: 1 },
        ],
    },
    bsi: {
        name: 'Bacharelado em Sistemas de Informação (campus Santa Mônica, Uberlândia)',
        curricula: [
            { name: '2009-1', startYear: 2009, startSemester: 1 },
            { name: '2016-1', startYear: 2016, startSemester: 1 },
            { name: '2022-2', startYear: 2022, startSemester: 2 },
        ],
    },
    'bsi-mc': {
        name: 'Bacharelado em Sistemas de Informação (campus Monte Carmelo)',
        curricula: [
            { name: '2016', startYear: 2016, startSemester: 1 },
            { name: '2022', startYear: 2022, startSemester: 2 },
        ],
    },
    bia: {
        name: 'Bacharelado em Inteligência Artificial',
        curricula: [{ name: 'único (curso criado em 2025)', startYear: 2025, startSemester: 1 }],
    },
};

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

function describeProfile(courseId, entryYear) {
    const course = COURSES[courseId];
    if (!course) return null;
    const curricula = curriculumFor(courseId, entryYear).map((c) => c.name);
    const curriculumText = curricula.length > 1
        ? `currículo ${curricula.join(' ou ')} (depende do semestre de ingresso)`
        : `currículo ${curricula[0]}`;
    return { courseName: course.name, entryYear, curricula, text: `${course.name}, ingresso em ${entryYear}, ${curriculumText}` };
}

module.exports = { COURSES, curriculumFor, describeProfile };
