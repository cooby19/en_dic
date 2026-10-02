"""Verify confirmed MVP decisions and acceptance boundaries in both product docs."""
from pathlib import Path
import re
import unittest
ROOT = Path(__file__).resolve().parents[1]

class ProductTechnologyTests(unittest.TestCase):
    def test_relative_document_links_resolve(self):
        for name in ('PRODUCT_TECHNOLOGY.md', 'PRODUCT_OUTLINE.md', 'QUALITY_RECORD.md'):
            text = (ROOT / name).read_text(encoding='utf-8')
            for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
                if not target.startswith('https://'):
                    with self.subTest(name=name, target=target):
                        self.assertTrue((ROOT / target.split('#', 1)[0]).is_file())

    def test_confirmed_decisions_are_synchronized(self):
        for name in ('PRODUCT_TECHNOLOGY.md', 'PRODUCT_OUTLINE.md'):
            text = (ROOT / name).read_text(encoding='utf-8')
            for decision in ('PWA', 'Google 邀請制', 'Gemini', 'Vault', 'ChatGPT OAuth', '取消收藏', '14 × 24', 'Render Free', 'Supabase Free', '10 次', '100 次', '4,096', '60 秒', 'JSON', '36 / 40'):
                with self.subTest(name=name, decision=decision): self.assertIn(decision, text)
            for obsolete in ('仍待產品確認', '尚待確認', '供應商待選', '不再是唯一', '取消收藏後，建議'):
                with self.subTest(name=name, obsolete=obsolete): self.assertNotIn(obsolete, text)

    def test_model_auth_and_product_login_are_distinct(self):
        text = (ROOT / 'PRODUCT_TECHNOLOGY.md').read_text(encoding='utf-8')
        for expected in ('@earendil-works/pi-ai@0.99.2', '產品帳號登入與模型供應商授權為兩個獨立流程', '每人自己的', '唯讀 CredentialStore', '禁止環境及主機憑證回退', '不靜默改用其他帳號或付費 API', 'https://ai.google.dev/gemini-api/docs/pricing', 'https://ai.google.dev/gemini-api/docs/rate-limits'):
            with self.subTest(expected=expected): self.assertIn(expected, text)

    def test_tests_preserve_unverified_external_boundaries(self):
        text = (ROOT / 'PRODUCT_TECHNOLOGY.md').read_text(encoding='utf-8')
        for expected in ('不同帳號', '429', '已保存收藏', '解除連接', '真實雲端', '真實模型待驗收', '實機驗收', 'Vault stub', 'advisory lock', 'checksum', 'bfcache'):
            with self.subTest(expected=expected): self.assertIn(expected, text)
        record = (ROOT / 'QUALITY_RECORD.md').read_text(encoding='utf-8')
        self.assertEqual(len(re.findall(r'^\| Q\d{2} \|', record, re.MULTILINE)), 40)
        self.assertIn('真實 Gemini 尚未執行', record)
