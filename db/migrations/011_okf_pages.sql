-- Páginas dos sites (pacote OKF em conhecimento/) entram como documentos de outro tipo, ao lado das normas.
-- kind separa as normas (PDFs) das páginas; content_hash é o hash do conteúdo no pacote, que decide se a página
-- precisa ser reimportada; uma página que sai do pacote vira "removido".
ALTER TABLE documents ADD COLUMN kind TEXT NOT NULL DEFAULT 'norma'
    CHECK (kind IN ('norma', 'pagina', 'noticia', 'edital'));
ALTER TABLE documents ADD COLUMN content_hash TEXT;
ALTER TABLE documents ADD COLUMN okf_path TEXT;

ALTER TABLE documents DROP CONSTRAINT documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
    CHECK (status IN ('vigente', 'revogado', 'duplicado', 'removido'));

-- Uma página é identificada pelo endereço: alterada, ela atualiza o mesmo documento.
CREATE UNIQUE INDEX documents_page_source_idx ON documents (source_url) WHERE kind <> 'norma';

-- Perfis de pessoas: dados estruturados, buscados só por palavra-chave (sem vetores).
CREATE TABLE pessoas (
    id                     SERIAL PRIMARY KEY,
    source_url             TEXT NOT NULL UNIQUE,
    okf_path               TEXT NOT NULL,
    unidade                TEXT NOT NULL,
    nome                   TEXT NOT NULL,
    categoria              TEXT,
    cargo                  TEXT,
    funcao                 TEXT,
    situacao               TEXT,
    titulacao              TEXT,
    regime                 TEXT,
    lotacao                TEXT,
    endereco               TEXT,
    email                  TEXT,
    telefone               TEXT,
    ramal                  TEXT,
    resumo                 TEXT,
    atualizado             DATE,
    content_hash           TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'removido')),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    tsv                    tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('pt_unaccent', pt_normalize(nome)), 'A')
        || setweight(to_tsvector('pt_unaccent', pt_normalize(
            coalesce(categoria, '') || ' ' || coalesce(cargo, '') || ' ' || coalesce(funcao, '') || ' '
            || coalesce(lotacao, '') || ' ' || coalesce(unidade, ''))), 'B')
        || setweight(to_tsvector('pt_unaccent', pt_normalize(coalesce(resumo, ''))), 'D')
    ) STORED
);
CREATE INDEX pessoas_tsv_idx ON pessoas USING gin (tsv);
