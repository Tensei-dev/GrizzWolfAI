ALTER TABLE documents ADD COLUMN subject TEXT;

UPDATE documents d
SET subject = regexp_replace(
    substring(
        (SELECT string_agg(c.content, ' ' ORDER BY c.chunk_index) FROM chunks c
         WHERE c.document_id = d.id AND c.chunk_index < 4)
        FROM '(?:Aprova|Dispõe sobre|Estabelece|Altera|Regulamenta|Institui|Normatiza|Define)\s[^.]{10,250}'
    ),
    '\s+', ' ', 'g'
);
