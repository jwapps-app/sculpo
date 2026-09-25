"""The migrations are what production runs; the suite's create_all is not.
Run them on an empty database and check the schema they produce is the
schema the models describe — a column added to a model and forgotten in a
migration fails here, not on the first deploy."""

import pathlib

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.config import settings
from app.database import Base


def test_migrations_build_the_models_schema(tmp_path: pathlib.Path, monkeypatch):
    db_file = tmp_path / "migrated.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_file}")
    cfg = Config(str(pathlib.Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", str(pathlib.Path(__file__).resolve().parents[1] / "alembic"))
    command.upgrade(cfg, "head")

    migrated = inspect(create_engine(f"sqlite:///{db_file}"))
    tables = set(migrated.get_table_names()) - {"alembic_version"}
    assert tables == set(Base.metadata.tables), "tables differ between migrations and models"
    for name, table in Base.metadata.tables.items():
        expected = {c.name for c in table.columns}
        actual = {c["name"] for c in migrated.get_columns(name)}
        assert actual == expected, f"{name}: migrations give {actual}, models expect {expected}"


def test_downgrade_to_base_is_clean(tmp_path: pathlib.Path, monkeypatch):
    db_file = tmp_path / "down.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_file}")
    cfg = Config(str(pathlib.Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("script_location", str(pathlib.Path(__file__).resolve().parents[1] / "alembic"))
    command.upgrade(cfg, "head")
    try:
        command.downgrade(cfg, "base")
    except NotImplementedError:
        # Migration 0002 has no downgrade by design (it was destructive).
        pytest.skip("a migration declares no downgrade")
    assert set(inspect(create_engine(f"sqlite:///{db_file}")).get_table_names()) <= {"alembic_version"}
