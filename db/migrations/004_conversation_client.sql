ALTER TABLE conversations
    ADD COLUMN client_id UUID,
    ADD COLUMN title TEXT;

CREATE INDEX conversations_client_idx ON conversations (client_id, created_at DESC);
