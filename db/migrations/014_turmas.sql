-- Quem dá cada disciplina, lido dos horários de aula publicados pelas unidades (services/teaching.js). Uma linha por
-- turma e docente; docente sem ligação com o cadastro fica com pessoa_id nulo e o nome como aparece na grade.
CREATE TABLE turmas (
    id          SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    curso       TEXT NOT NULL,          -- id do curso (services/courses.js)
    semestre    TEXT NOT NULL,          -- "2026/2"
    codigo      TEXT NOT NULL,
    disciplina  TEXT NOT NULL,
    turma       TEXT,
    docente     TEXT,                   -- nome como está na grade
    pessoa_id   INTEGER REFERENCES pessoas(id) ON DELETE SET NULL,
    horarios    TEXT[] NOT NULL DEFAULT '{}',
    tsv         tsvector GENERATED ALWAYS AS (to_tsvector('pt_unaccent', pt_normalize(codigo || ' ' || disciplina))) STORED
);

CREATE INDEX turmas_pessoa_idx ON turmas (pessoa_id);
CREATE INDEX turmas_curso_idx ON turmas (curso, semestre);
CREATE INDEX turmas_tsv_idx ON turmas USING gin (tsv);
