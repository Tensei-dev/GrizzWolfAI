CREATE TABLE kg_nodes (
    id          SERIAL PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('unidade', 'curso', 'curriculo', 'assunto', 'documento')),
    key         TEXT NOT NULL,
    label       TEXT NOT NULL,
    document_id INTEGER UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE (type, key)
);

CREATE TABLE kg_edges (
    source_id INTEGER NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    relation  TEXT NOT NULL CHECK (relation IN ('pertence_a', 'emitido_por', 'aplica_a', 'trata_de', 'altera', 'revoga', 'cita')),
    target_id INTEGER NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    origin    TEXT NOT NULL DEFAULT 'regra' CHECK (origin IN ('regra', 'llm')),
    PRIMARY KEY (source_id, relation, target_id)
);

CREATE INDEX kg_edges_target_idx ON kg_edges (target_id, relation);

ALTER TABLE documents ADD COLUMN graph_built_at TIMESTAMPTZ;
