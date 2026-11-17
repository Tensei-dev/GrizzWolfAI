-- Uso diário das APIs com cota (vetores do Gemini), por origem: as importações param antes de gastar a parte
-- reservada para as buscas do chat. O dia segue o fuso do Pacífico, que é quando a cota do Gemini renova.
CREATE TABLE api_usage (
    day     DATE NOT NULL,
    service TEXT NOT NULL,   -- ex.: "gemini"
    source  TEXT NOT NULL,   -- ex.: "chat", "import-okf", "sync-documents"
    units   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, service, source)
);
