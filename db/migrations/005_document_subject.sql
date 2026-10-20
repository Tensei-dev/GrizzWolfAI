-- ementa do documento ("Aprova as Normas de Estágio do curso de ..."): o título das
-- resoluções não diz o assunto nem o curso, e o trecho encontrado na busca nem sempre também
ALTER TABLE documents ADD COLUMN subject TEXT;

-- preenche a partir dos primeiros trechos de cada documento já importado
-- (a mesma regra de services/ingestion.js extractSubject)
UPDATE documents d
SET subject = regexp_replace(
    substring(
        (SELECT string_agg(c.content, ' ' ORDER BY c.chunk_index) FROM chunks c
         WHERE c.document_id = d.id AND c.chunk_index < 4)
        FROM '(?:Aprova|Dispõe sobre|Estabelece|Altera|Regulamenta|Institui|Normatiza|Define)\s[^.]{10,250}'
    ),
    '\s+', ' ', 'g'
);
