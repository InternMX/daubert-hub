"""Focused exporter tests using an isolated SQLite fixture, never the production database."""
import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("payment_export", Path(__file__).with_name("export-payment-workflow-readonly.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExportTest(unittest.TestCase):
    def fixture(self, root, drift=False):
        database = root / "source.sqlite"
        published = [{"name": str(i), "position": [0, 0], "parameters": {"value": "unchanged"}} for i in range(108)]
        draft = json.loads(json.dumps(published))
        for node in draft:
            node["position"] = [100, 200]
        if drift:
            draft[0]["parameters"]["value"] = "changed"
        with closing(sqlite3.connect(database)) as conn:
            conn.execute("CREATE TABLE workflow_entity(id,name,active,versionId,activeVersionId,nodes,connections,settings,pinData,staticData)")
            conn.execute("CREATE TABLE workflow_history(workflowId,versionId,nodes,connections)")
            conn.execute("INSERT INTO workflow_entity VALUES(?,?,?,?,?,?,?,?,?,?)", (
                "pagosProdAsignaciones01", "Synthetic", 1, "draft", "published", json.dumps(draft), "{}", "{}", "{}", None))
            conn.execute("INSERT INTO workflow_history VALUES(?,?,?,?)", ("pagosProdAsignaciones01", "published", json.dumps(published), "{}"))
            conn.commit()
        return database

    def test_published_nodes_are_exported_without_changing_sqlite(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); output = root / "artifacts"; output.mkdir()
            database = self.fixture(root); before = database.read_bytes()
            manifest = module.export(database, output)
            self.assertEqual(database.read_bytes(), before)
            self.assertEqual(manifest["publishedVersionId"], "published")
            self.assertEqual(json.loads((output / "payment-production-source.json").read_text())["nodes"][0]["position"], [0, 0])

    def test_business_drift_is_rejected_without_writing_an_export(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); output = root / "artifacts"; output.mkdir()
            database = self.fixture(root, drift=True)
            with self.assertRaisesRegex(ValueError, "business drift"):
                module.export(database, output)
            self.assertEqual(list(output.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
