CREATE TABLE rate_limits (
    bucket       TEXT NOT NULL,
    visitor      TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    hits         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, visitor, window_start)
);

CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);
