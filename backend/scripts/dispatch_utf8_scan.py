"""Scan dispatch tables for garbled text (read-only)."""
import os
import re
import sys

import pymysql
from pymysql.cursors import DictCursor


def main():
    pw = os.environ.get("MYSQL_PASSWORD")
    if not pw:
        print("MYSQL_PASSWORD", file=sys.stderr)
        sys.exit(2)
    c = pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "rm-bp1qfn803665w166yjo.mysql.rds.aliyuncs.com"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "demeter_dev_v2"),
        password=pw,
        database="demeter-dev-v2",
        charset="utf8mb4",
        cursorclass=DictCursor,
    )
    cur = c.cursor()
    cur.execute("SELECT task_id, title FROM dispatch_task")
    bad_t = []
    for r in cur.fetchall():
        t = r["title"] or ""
        if re.search(r"\?{3,}", t) or "\ufffd" in t:
            bad_t.append((r["task_id"], t[:80]))
    print("dispatch_task garbled titles:", len(bad_t))
    for x in bad_t:
        print(" ", x)

    cur.execute("SELECT id, LEFT(content_md,120) s FROM dispatch_artifact WHERE content_md LIKE '%???%' OR content_md LIKE '%????%'")
    # use python side check
    cur.execute("SELECT id, team, artifact_path FROM dispatch_artifact")
    bad_a = []
    for r in cur.fetchall():
        cur.execute("SELECT content_md FROM dispatch_artifact WHERE id=%s", (r["id"],))
        md = cur.fetchone()["content_md"] or ""
        if re.search(r"\?{3,}", md) or "\ufffd" in md:
            bad_a.append((r["id"], r["team"], r["artifact_path"][:60]))
    print("dispatch_artifact garbled content_md:", len(bad_a))
    for x in bad_a[:40]:
        print(" ", x)
    if len(bad_a) > 40:
        print(" ...", len(bad_a) - 40, "more")
    c.close()


if __name__ == "__main__":
    main()
