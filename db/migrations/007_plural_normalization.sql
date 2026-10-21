CREATE OR REPLACE FUNCTION pt_normalize(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT regexp_replace(regexp_replace(lower($1), 'ões\M', 'ão', 'g'), 'ães\M', 'ão', 'g')
$$;

DROP INDEX IF EXISTS chunks_tsv_idx;
ALTER TABLE chunks DROP COLUMN tsv;
ALTER TABLE chunks ADD COLUMN tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('pt_unaccent', pt_normalize(content))) STORED;
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
