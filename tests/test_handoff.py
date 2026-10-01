"""Keep the handoff actionable and explicit about unverified service boundaries."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HandoffTests(unittest.TestCase):
    def test_handoff_records_scope_validation_and_next_steps(self):
        text = (ROOT / 'handoff.md').read_text(encoding='utf-8')
        for expected in ('先完成本機實作與測試，雲端設定稍後提供', '完整 MVP 尚未交付',
                         '9 / 9', 'Vault 为 stub', 'request ref', 'scripts/migrate.ts',
                         '36 / 40', '禁止批量刪除', 'Git commit', 'EN_DIC_CONFIG'):
            with self.subTest(expected=expected):
                self.assertIn(expected, text)

    def test_implemented_source_references_exist(self):
        text = (ROOT / 'handoff.md').read_text(encoding='utf-8')
        implemented = text.split('## 4. 已寫入的程式與檔案', 1)[1].split('## 5.', 1)[0]
        for target in re.findall(r'`([^`]+)`', implemented):
            if target.startswith(('apps/', 'packages/', 'supabase/', 'tests/')) and '*' not in target:
                with self.subTest(target=target):
                    self.assertTrue((ROOT / target).exists())


if __name__ == '__main__':
    unittest.main()
