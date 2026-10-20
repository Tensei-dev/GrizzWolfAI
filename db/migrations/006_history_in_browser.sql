-- o histórico das conversas passa a ficar só no navegador de cada aluno.
-- o banco guarda apenas as respostas que o aluno avaliou, de forma anônima,
-- para analisarmos a qualidade do Grizz
DROP TABLE IF EXISTS feedback, message_sources, messages, conversations CASCADE;

CREATE TABLE feedback (
    id         SERIAL PRIMARY KEY,
    -- id da resposta gerado no navegador: impede avaliar a mesma resposta duas vezes
    answer_id  UUID NOT NULL UNIQUE,
    rating     SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
    comment    TEXT,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    -- [{ n, chunkId, title, page, sourceUrl }] na ordem das citações [n]
    sources    JSONB NOT NULL DEFAULT '[]',
    course     TEXT,
    entry_year INTEGER,
    model      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
