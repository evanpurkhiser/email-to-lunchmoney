-- Migration number: 0001 	 2025-07-09T04:00:03.513Z

CREATE TABLE lunchmoney_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_created DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT NOT NULL,
    action TEXT NOT NULL
);
