-- documentos com o mesmo texto de outro: ficam registrados (para a sincronização não
-- reimportar o link), sem trechos, e apontando para o original em replaced_by
ALTER TABLE documents DROP CONSTRAINT documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
    CHECK (status IN ('vigente', 'revogado', 'duplicado'));
