CREATE TABLE letters (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  fold TEXT NOT NULL,
  preset TEXT NOT NULL,
  day TEXT NOT NULL,
  sender TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX letters_day ON letters (day, sender);
