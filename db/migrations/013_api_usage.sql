CREATE TABLE api_usage (
    day     DATE NOT NULL,
    service TEXT NOT NULL,
    source  TEXT NOT NULL,
    units   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, service, source)
);
