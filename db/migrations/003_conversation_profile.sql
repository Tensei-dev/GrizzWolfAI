ALTER TABLE conversations
    ADD COLUMN course TEXT,
    ADD COLUMN entry_year INTEGER,
    ADD COLUMN pending_question TEXT,
    ADD COLUMN profile_prompts SMALLINT NOT NULL DEFAULT 0;
