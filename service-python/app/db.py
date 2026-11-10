from sqlalchemy import create_engine, event, text

from .config import settings

if not settings.db_file.exists():
    raise RuntimeError(
        f"Database file not found: {settings.db_file}\n"
        "Create it first:  sqlite3 db/worksphere.db < db/schema.sql && sqlite3 db/worksphere.db < db/seed.sql"
    )

# Raw SQL via SQLAlchemy Core keeps this service small; the schema lives in db/schema.sql.
# check_same_thread=False lets the APScheduler thread share the engine with the web workers.
engine = create_engine(settings.db_url, connect_args={"check_same_thread": False, "timeout": 5})


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys = ON")   # SQLite enforces FKs only when asked
    cur.execute("PRAGMA journal_mode = WAL")  # Node API can read while this service writes
    cur.execute("PRAGMA busy_timeout = 5000")
    cur.close()


def fetch_all(sql: str, **params) -> list[dict]:
    with engine.connect() as conn:
        return [dict(row._mapping) for row in conn.execute(text(sql), params)]


def fetch_one(sql: str, **params) -> dict | None:
    rows = fetch_all(sql, **params)
    return rows[0] if rows else None
