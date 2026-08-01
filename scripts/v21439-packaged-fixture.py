#!/usr/bin/env python3

import json
import sqlite3
import sys
from pathlib import Path


LEGACY_KEY = "sk-v21439-packaged-fixture-1234567890"


def create_fixture(root: Path) -> None:
    if root.exists() and any(root.iterdir()):
        raise RuntimeError(f"fixture directory is not empty: {root}")

    data_dir = root / "data"
    workflows_dir = root / "workflows"
    data_dir.mkdir(parents=True, exist_ok=True)
    workflows_dir.mkdir(parents=True, exist_ok=True)

    database = sqlite3.connect(data_dir / "jarvis.db")
    try:
        database.executescript(
            """
            CREATE TABLE conversations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              role TEXT NOT NULL,
              from_id TEXT NOT NULL,
              to_id TEXT,
              content TEXT NOT NULL,
              timestamp TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE memories (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT NOT NULL,
              content TEXT NOT NULL,
              detail TEXT NOT NULL,
              entities TEXT DEFAULT '[]',
              concepts TEXT DEFAULT '[]',
              tags TEXT DEFAULT '[]',
              source_ref TEXT,
              timestamp TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE config (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE action_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp TEXT NOT NULL,
              tool TEXT NOT NULL,
              summary TEXT NOT NULL,
              detail TEXT NOT NULL DEFAULT ''
            );
            """
        )
        database.execute(
            "INSERT INTO conversations(role, from_id, to_id, content, timestamp) VALUES (?, ?, ?, ?, ?)",
            ("user", "ID:000001", None, "2.1.439 packaged conversation survives", "2026-07-03T00:00:00.000Z"),
        )
        database.execute(
            "INSERT INTO memories(event_type, content, detail, timestamp) VALUES (?, ?, ?, ?)",
            ("knowledge", "2.1.439 packaged memory survives", "fixture detail", "2026-07-03T00:00:01.000Z"),
        )
        database.execute("INSERT INTO config(key, value) VALUES (?, ?)", ("fixture-setting", "retained"))
        database.commit()
    finally:
        database.close()

    (root / "config.json").write_text(
        json.dumps(
            {
                "version": "2.1.439",
                "provider": "deepseek",
                "model": "deepseek-chat",
                "apiKey": LEGACY_KEY,
                "temperature": 0.6,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (workflows_dir / "legacy.json").write_text('{"name":"legacy"}', encoding="utf-8")
    (root / "mcp.servers.json").write_text('{"mcpServers":{}}', encoding="utf-8")
    print(f"Created realistic v2.1.439 packaged migration fixture: {root}")


def verify_fixture(root: Path) -> None:
    state = json.loads((root / "data" / "migration-state.json").read_text(encoding="utf-8"))
    if state.get("status") != "complete":
        raise AssertionError(f"migration did not complete: {state}")

    backup_dir = Path(state["backupDir"])
    for relative in ("config.json", "data/jarvis.db", "workflows/legacy.json", "mcp.servers.json"):
        if not (backup_dir / relative).is_file():
            raise AssertionError(f"migration backup is missing {relative}: {backup_dir}")

    backup_config = (backup_dir / "config.json").read_text(encoding="utf-8")
    current_config = (root / "config.json").read_text(encoding="utf-8")
    provider_config = (root / "llm" / "deepseek.json").read_text(encoding="utf-8")
    if LEGACY_KEY not in backup_config:
        raise AssertionError("pre-upgrade backup did not retain the recoverable legacy credential")
    if LEGACY_KEY in current_config or LEGACY_KEY in provider_config:
        raise AssertionError("legacy plaintext credential remains in active configuration")
    if "v1:" not in provider_config and "v2:" not in provider_config:
        raise AssertionError("active provider credential was not migrated to encrypted storage")

    database = sqlite3.connect(root / "data" / "jarvis.db")
    try:
        conversation = database.execute("SELECT content FROM conversations WHERE id = 1").fetchone()
        memory = database.execute("SELECT content FROM memories WHERE id = 1").fetchone()
        setting = database.execute("SELECT value FROM config WHERE key = 'fixture-setting'").fetchone()
        conversation_columns = {row[1] for row in database.execute("PRAGMA table_info(conversations)")}
        memory_columns = {row[1] for row in database.execute("PRAGMA table_info(memories)")}
        brain_ui_table = database.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='brain_ui_events'"
        ).fetchone()
    finally:
        database.close()

    if conversation != ("2.1.439 packaged conversation survives",):
        raise AssertionError(f"legacy conversation was not preserved: {conversation}")
    if memory != ("2.1.439 packaged memory survives",):
        raise AssertionError(f"legacy memory was not preserved: {memory}")
    if setting != ("retained",):
        raise AssertionError(f"legacy database configuration was not preserved: {setting}")
    if "thread_id" not in conversation_columns or "embedding_model" not in memory_columns or not brain_ui_table:
        raise AssertionError("incremental database schema migration is incomplete")
    if not (root / "workflows" / "legacy.json").is_file() or not (root / "mcp.servers.json").is_file():
        raise AssertionError("workflow or MCP configuration was not preserved")

    print("Packaged v2.1.439 data migration, backup, SQLite and credential encryption: OK")


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"create", "verify"}:
        raise SystemExit("usage: v21439-packaged-fixture.py create|verify <user-dir>")
    root = Path(sys.argv[2]).resolve()
    if sys.argv[1] == "create":
        create_fixture(root)
    else:
        verify_fixture(root)


if __name__ == "__main__":
    main()
