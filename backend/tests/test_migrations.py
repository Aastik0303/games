"""The Alembic migration produces exactly the schema the models describe."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

from app.db.models import Base

ROOT = Path(__file__).resolve().parents[1]


def test_upgrade_matches_models(tmp_path: Path) -> None:
    db = tmp_path / "migrated.db"
    url = f"sqlite+aiosqlite:///{db.as_posix()}"
    result = subprocess.run(  # noqa: S603 - fixed argv
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT,
        env={**os.environ, "PRISM_DATABASE_URL": url},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    insp = inspect(create_engine(f"sqlite:///{db.as_posix()}"))
    for table in Base.metadata.sorted_tables:
        assert insp.has_table(table.name), table.name
        migrated = {c["name"]: c for c in insp.get_columns(table.name)}
        assert set(migrated) == {c.name for c in table.columns}, table.name
        for col in table.columns:
            assert migrated[col.name]["nullable"] == col.nullable or col.primary_key, (table.name, col.name)
        indexed = {tuple(i["column_names"]) for i in insp.get_indexes(table.name)}
        for idx in table.indexes:
            assert tuple(c.name for c in idx.columns) in indexed, (table.name, idx.name)
