-- O título e a ementa do documento entram na busca por palavras-chave de cada trecho, com peso A (o conteúdo fica
-- com o peso D de antes). Em PDFs escaneados, fichas e tabelas, o título da listagem do site é o texto mais confiável:
-- sem ele, a ficha "Cálculo Diferencial e Integral II" com OCR "INTEGRAL TI" não era encontrada.
ALTER TABLE chunks ADD COLUMN heading TEXT;

UPDATE chunks c
SET heading = concat_ws(' ', d.title, d.subject)
FROM documents d
WHERE d.id = c.document_id;

DROP INDEX IF EXISTS chunks_tsv_idx;
ALTER TABLE chunks DROP COLUMN tsv;
ALTER TABLE chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('pt_unaccent', pt_normalize(coalesce(heading, ''))), 'A')
    || setweight(to_tsvector('pt_unaccent', pt_normalize(content)), 'D')
) STORED;
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
