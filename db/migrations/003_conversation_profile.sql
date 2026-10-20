-- perfil do aluno, perguntado no início da conversa para identificar o currículo
ALTER TABLE conversations
    ADD COLUMN course TEXT,
    ADD COLUMN entry_year INTEGER,
    -- pergunta feita antes de o aluno informar o perfil; respondida quando ele completar
    ADD COLUMN pending_question TEXT,
    -- quantas vezes o Grizz já pediu o perfil (para não insistir para sempre)
    ADD COLUMN profile_prompts SMALLINT NOT NULL DEFAULT 0;
