"""Read the published payment workflow from SQLite; write an offline export, never to n8n."""
import argparse
from contextlib import closing
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sqlite3


def export(database, output):
    database, output = Path(database).resolve(), Path(output).resolve()
    if not output.is_dir() or (output / ".git").exists():
        raise ValueError("Use an existing private artifact directory outside the repository")
    if Path(__file__).resolve().parents[2] in output.parents or output == database.parent:
        raise ValueError("Exports must stay outside the repository and n8n data directory")
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        conn.execute("BEGIN")
        row = conn.execute("SELECT * FROM workflow_entity WHERE id='pagosProdAsignaciones01'").fetchone()
        if not row or not row["active"]:
            raise ValueError("Expected the active production workflow")
        history = conn.execute("SELECT * FROM workflow_history WHERE workflowId=? AND versionId=?",
                               (row["id"], row["activeVersionId"])).fetchone()
        if not history:
            raise ValueError("Published version missing: do not fall back to a draft")
        nodes, connections = json.loads(history["nodes"]), json.loads(history["connections"])
        if len(nodes) != 108:
            raise ValueError("Expected 108 published nodes; review drift before promotion")
        workflow = {"id": row["id"], "name": row["name"], "active": True,
                    "nodes": nodes, "connections": connections, "settings": json.loads(row["settings"] or "{}"),
                    "pinData": json.loads(row["pinData"] or "{}"), "staticData": json.loads(row["staticData"] or "null")}
        if workflow["pinData"]:
            raise ValueError("Pinned execution data must not enter the promotion input")
        draft = {n["name"]: {k: v for k, v in n.items() if k != "position"} for n in json.loads(row["nodes"])}
        published = {n["name"]: {k: v for k, v in n.items() if k != "position"} for n in nodes}
        if draft != published or json.loads(row["connections"]) != connections:
            raise ValueError("Published/draft business drift requires review")
        data = (json.dumps(workflow, ensure_ascii=False, indent=2) + "\n").encode()
        manifest = {"workflowId": row["id"], "publishedVersionId": row["activeVersionId"],
                    "draftVersionId": row["versionId"], "nodeCount": len(nodes),
                    "businessDraftEqualsPublished": True, "sha256": hashlib.sha256(data).hexdigest(),
                    "capturedAt": datetime.now(timezone.utc).isoformat()}
        conn.rollback()
    (output / "payment-production-source.json").write_bytes(data)
    (output / "payment-production-source.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database")
    parser.add_argument("output")
    args = parser.parse_args()
    print(json.dumps(export(args.database, args.output)))
