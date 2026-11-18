ALTER TABLE pessoas ADD COLUMN areas TEXT;
ALTER TABLE pessoas ADD COLUMN embedding vector(768);
ALTER TABLE pessoas ADD COLUMN embedding_hash TEXT;

DROP INDEX IF EXISTS pessoas_tsv_idx;
ALTER TABLE pessoas DROP COLUMN tsv;
ALTER TABLE pessoas ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('pt_unaccent', pt_normalize(nome)), 'A')
    || setweight(to_tsvector('pt_unaccent', pt_normalize(coalesce(areas, ''))), 'B')
    || setweight(to_tsvector('pt_unaccent', pt_normalize(
        coalesce(categoria, '') || ' ' || coalesce(cargo, '') || ' ' || coalesce(funcao, '') || ' '
        || coalesce(lotacao, '') || ' ' || coalesce(unidade, ''))), 'C')
    || setweight(to_tsvector('pt_unaccent', pt_normalize(coalesce(resumo, ''))), 'D')
) STORED;
CREATE INDEX pessoas_tsv_idx ON pessoas USING gin (tsv);
