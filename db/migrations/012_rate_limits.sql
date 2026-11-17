-- Contador de requisições por visitante e janela de tempo, para o /api/chat não esgotar as cotas gratuitas da Groq e do
-- Gemini. Fica no banco porque na Vercel cada requisição pode cair numa instância diferente (memória não serve).
-- visitor é um hash do IP com sal secreto: o IP não é guardado.
CREATE TABLE rate_limits (
    bucket       TEXT NOT NULL,          -- ex.: "chat:min", "chat:dia"
    visitor      TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    hits         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, visitor, window_start)
);

CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);
