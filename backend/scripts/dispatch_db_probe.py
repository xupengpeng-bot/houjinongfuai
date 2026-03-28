import os
import sys
from pathlib import Path

try:
    import pymysql
except Exception as exc:
    print(f"PyMySQL unavailable: {exc}", file=sys.stderr)
    sys.exit(2)


def load_local_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def main() -> int:
    load_local_env()
    cfg = dict(
        host=os.getenv("DISPATCH_DB_HOST"),
        port=int(os.getenv("DISPATCH_DB_PORT", "3306")),
        user=os.getenv("DISPATCH_DB_USER"),
        password=os.getenv("DISPATCH_DB_PASSWORD"),
        database=os.getenv("DISPATCH_DB_NAME"),
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=8,
        read_timeout=8,
        write_timeout=8,
    )

    missing = [k for k, v in cfg.items() if v in (None, "") and k != "port"]
    if missing:
        print(f"Missing env vars: {', '.join(missing)}", file=sys.stderr)
        return 1

    conn = pymysql.connect(**cfg)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT team, status, COALESCE(active_task_id, ''), COALESCE(work_mode, '') FROM dispatch_team_current ORDER BY team")
            teams = cur.fetchall()
            cur.execute("SELECT COUNT(*) FROM dispatch_task")
            task_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM dispatch_artifact")
            artifact_count = cur.fetchone()[0]
    finally:
        conn.close()

    print({"teams": teams, "task_count": task_count, "artifact_count": artifact_count})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
