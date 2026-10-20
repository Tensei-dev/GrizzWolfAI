DROP TABLE IF EXISTS feedback, message_sources, messages, conversations CASCADE;

CREATE TABLE feedback (
    id         SERIAL PRIMARY KEY,
    answer_id  UUID NOT NULL UNIQUE,
    rating     SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
    comment    TEXT,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    sources    JSONB NOT NULL DEFAULT '[]',
    course     TEXT,
    entry_year INTEGER,
    model      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
