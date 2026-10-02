"""Keep progress references and task tracking consistent as work advances."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ProgressTests(unittest.TestCase):
    def test_local_document_links_resolve(self):
        text = (ROOT / 'PROGRESS.md').read_text(encoding='utf-8')
        for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
            with self.subTest(target=target):
                self.assertTrue((ROOT / target.split('#', 1)[0]).is_file())

    def test_task_ids_are_unique_and_statuses_are_valid(self):
        text = (ROOT / 'PROGRESS.md').read_text(encoding='utf-8')
        rows = re.findall(r'^\| [LC]\d+ \|[^\n]+', text, re.MULTILINE)
        self.assertTrue(rows, 'Progress must include tracked tasks')
        ids = [row.split('|')[1].strip() for row in rows]
        self.assertEqual(len(ids), len(set(ids)), 'Task IDs must not be duplicated')
        for row in rows:
            with self.subTest(row=row):
                cells = [cell.strip() for cell in row.split('|')[1:-1]]
                self.assertEqual(len(cells), 5)
                self.assertIn(cells[3], ('待開始', '進行中', '待驗證', '受阻', '已完成'))
                self.assertTrue(cells[4], 'Each task needs a next step or acceptance condition')


if __name__ == '__main__':
    unittest.main()
