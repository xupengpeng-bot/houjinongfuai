"""
Fix mojibake in dispatch_task / dispatch_artifact using UTF-8 source files.

- File reads: encoding='utf-8'
- MySQL: charset='utf8mb4'
- Never paste terminal echo into SQL

Usage:
  set MYSQL_PASSWORD=...
  python dispatch_utf8_cleanup.py [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import pymysql
from pymysql.cursors import DictCursor

REPO_ROOT = Path(__file__).resolve().parents[2]
BASE_HOUJIN = Path(os.environ.get("HOUJIN_REPO", str(REPO_ROOT)))
BASE_LOVABLE = Path(os.environ.get("LOVABLE_REPO", str(REPO_ROOT.parent / "lovable")))


def connect():
    pw = os.environ.get("MYSQL_PASSWORD") or os.environ.get("DISPATCH_DB_PASSWORD")
    if not pw:
        print("Set MYSQL_PASSWORD", file=sys.stderr)
        sys.exit(2)
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "rm-bp1qfn803665w166yjo.mysql.rds.aliyuncs.com"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "demeter_dev_v2"),
        password=pw,
        database=os.environ.get("MYSQL_DATABASE", "demeter-dev-v2"),
        charset="utf8mb4",
        cursorclass=DictCursor,
    )


def resolve_local_path(raw: str | None) -> Path | None:
    if not raw:
        return None
    s = raw.strip().replace("/", "\\")
    low = s.lower()
    try:
        if "lovablecomhis" in low:
            i = low.index("lovablecomhis")
            tail = s[i :].split("\\")
            p = BASE_LOVABLE / Path(*tail)
            if p.is_file():
                return p
        if "houjinongfuai" in low and ("docs" in low or "backend" in low):
            i = low.index("houjinongfuai")
            rest = s[i + len("houjinongfuai") :].lstrip("\\")
            p = BASE_HOUJIN / rest
            if p.is_file():
                return p
    except (ValueError, OSError):
        pass
    # try as-is
    p2 = Path(s)
    if p2.is_file():
        return p2
    return None


def read_utf8(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def title_from_md(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#"):
            return line.lstrip("#").strip()[:255]
    return ""


def looks_garbled_title(s: str | None) -> bool:
    if not s:
        return False
    if re.search(r"\?{3,}", s):
        return True
    return False


def looks_garbled_content(s: str | None) -> bool:
    if not s:
        return False
    if re.search(r"\?{3,}", s):
        return True
    if "\ufffd" in s:
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    fixed_tasks: list[str] = []
    fixed_arts: list[int] = []
    notes: list[str] = []

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT task_id, team, title, source_file, payload_md FROM dispatch_task")
            for row in cur.fetchall():
                tid = row["task_id"]
                src = row["source_file"] or ""
                if src.startswith("db://"):
                    continue
                path = resolve_local_path(src)
                if not path:
                    if looks_garbled_title(row.get("title")) or looks_garbled_content(row.get("payload_md")):
                        notes.append(f"task {tid}: cannot resolve path {row['source_file']!r}")
                    continue

                text = read_utf8(path)
                new_title = title_from_md(text) or str(tid)

                old_t = row.get("title") or ""
                old_p = row.get("payload_md") or ""
                # Repo file is source of truth: overwrite when differs or garbled
                if (
                    old_p == text
                    and old_t == new_title
                    and not looks_garbled_title(old_t)
                    and not looks_garbled_content(old_p)
                ):
                    continue

                if args.dry_run:
                    print(f"[dry-run] UPDATE dispatch_task task_id={tid} <- {path}")
                else:
                    cur.execute(
                        """
                        UPDATE dispatch_task
                        SET title=%s, payload_md=%s, updated_at=CURRENT_TIMESTAMP
                        WHERE task_id=%s
                        """,
                        (new_title, text, tid),
                    )
                    fixed_tasks.append(tid)

            cur.execute("SELECT id, team, task_id, artifact_path, content_md FROM dispatch_artifact")
            for row in cur.fetchall():
                aid = row["id"]
                path = resolve_local_path(row["artifact_path"])
                if not path:
                    if looks_garbled_content(row.get("content_md")):
                        notes.append(f"artifact {aid}: cannot resolve {row['artifact_path']!r}")
                    continue

                text = read_utf8(path)
                old_c = row.get("content_md") or ""
                if old_c == text and not looks_garbled_content(old_c):
                    continue

                if args.dry_run:
                    print(f"[dry-run] UPDATE dispatch_artifact id={aid} <- {path}")
                else:
                    cur.execute(
                        """
                        UPDATE dispatch_artifact
                        SET content_md=%s, updated_at=CURRENT_TIMESTAMP
                        WHERE id=%s
                        """,
                        (text, aid),
                    )
                    fixed_arts.append(aid)

            # DB-only tasks (no filesystem path): strip garbled titles using task_id or first line of payload
            cur.execute(
                "SELECT task_id, title, payload_md, source_file FROM dispatch_task WHERE source_file LIKE %s",
                ("db://%",),
            )
            for row in cur.fetchall():
                if not looks_garbled_title(row.get("title")):
                    continue
                tid = row["task_id"]
                payload = row.get("payload_md") or ""
                nt = tid
                if payload.strip().startswith("#"):
                    cand = title_from_md(payload) or tid
                    if cand and not looks_garbled_title(cand) and not re.search(r"\?{3,}", cand):
                        nt = cand
                if args.dry_run:
                    print(f"[dry-run] fix db-only title task_id={tid} -> {nt!r}")
                else:
                    cur.execute(
                        """
                        UPDATE dispatch_task
                        SET title=%s, updated_at=CURRENT_TIMESTAMP
                        WHERE task_id=%s
                        """,
                        (nt, tid),
                    )
                    fixed_tasks.append(f"{tid}:db-only-title")

            if not args.dry_run:
                conn.commit()
    finally:
        conn.close()

    print("---")
    print("fixed_task_ids:", fixed_tasks)
    print("fixed_artifact_ids:", fixed_arts)
    print("notes:")
    for n in notes:
        print(" ", n)


if __name__ == "__main__":
    main()
