import argparse
import json
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


def parse_summary(raw):
    if raw in (None, ""):
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return None
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch minimal dispatch bootstrap state directly from dispatch MySQL."
    )
    parser.add_argument("--team", default="software_engineer", help="dispatch team code")
    args = parser.parse_args()

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
        cursorclass=pymysql.cursors.DictCursor,
    )

    missing = [k for k, v in cfg.items() if v in (None, "") and k not in ("port", "cursorclass")]
    if missing:
        print(f"Missing env vars: {', '.join(missing)}", file=sys.stderr)
        return 1

    conn = pymysql.connect(**cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM dispatch_team_current WHERE team = %s LIMIT 1",
                (args.team,),
            )
            team = cur.fetchone()
            if not team:
                print(f"dispatch_team_current not found for team={args.team}", file=sys.stderr)
                return 3

            task = None
            active_task_id = (team.get("active_task_id") or "").strip()
            if active_task_id:
                cur.execute(
                    """
                    SELECT task_id, team, task_type, title, mode, status, purpose, source_file,
                           artifact_ref, summary_json, next_task_id, depends_on_task_id,
                           queue_order, updated_at, created_at, payload_md
                    FROM dispatch_task
                    WHERE task_id = %s
                    LIMIT 1
                    """,
                    (active_task_id,),
                )
                task = cur.fetchone()
                if task:
                    task["summary"] = parse_summary(task.pop("summary_json", None))
                    if task["summary"] is None and task.get("payload_md"):
                        task["payload_md_legacy"] = task.pop("payload_md")
                    else:
                        task.pop("payload_md", None)

        payload = {
            "source_of_truth": "dispatch_db",
            "team": team,
            "active_task": task,
        }
    finally:
        conn.close()

    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
