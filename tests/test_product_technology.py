"""Check documentation links and confirmed product decisions without API access."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ProductTechnologyTests(unittest.TestCase):
    def setUp(self):
        self.document = (ROOT / "PRODUCT_TECHNOLOGY.md").read_text(encoding="utf-8")

    def test_relative_document_links_resolve(self):
        for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", self.document):
            if not target.startswith("https://"):
                with self.subTest(target=target):
                    self.assertTrue((ROOT / target.split("#", 1)[0]).is_file())

    def test_confirmed_decisions_are_separate_from_suggestions(self):
        decisions = self.document.split("## 1. 已確認的產品決策\n", 1)[1].split("## 2.", 1)[0]
        for decision in ("雲端保存", "PWA", "不考慮 App 商店上架", "`gemini-3.8-flash`", "免費方案"):
            with self.subTest(decision=decision):
                self.assertIn(decision, decisions)
        self.assertIn("取消收藏後是否重新保留 14 天，仍待產品確認", self.document)

    def test_free_api_limits_and_failure_acceptance_are_documented(self):
        self.assertIn("https://ai.google.dev/gemini-api/docs/pricing", self.document)
        self.assertIn("https://ai.google.dev/gemini-api/docs/rate-limits", self.document)
        acceptance = self.document.split("## 7. 後續功能驗收與測試\n", 1)[1].split("## 8.", 1)[0]
        for scenario in ("不同帳號", "429", "14 天", "API Key", "已保存收藏"):
            with self.subTest(scenario=scenario):
                self.assertIn(scenario, acceptance)


if __name__ == "__main__":
    unittest.main()
