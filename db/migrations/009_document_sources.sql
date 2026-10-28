-- Todos os endereços em que um documento foi encontrado. O mesmo arquivo pode estar em mais de uma URL
-- (republicado com outro nome ou publicado no site das duas unidades); sem isso ele seria baixado de novo a cada sincronização.
CREATE TABLE document_sources (
    url         TEXT PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX document_sources_document_idx ON document_sources (document_id);

INSERT INTO document_sources (url, document_id)
SELECT DISTINCT ON (source_url) source_url, id FROM documents
WHERE source_url IS NOT NULL
ORDER BY source_url, id;
