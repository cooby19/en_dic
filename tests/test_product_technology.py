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
        for decision in ("雲端保存", "PWA", "不考慮 App 商店上架", "@earendil-works/pi-ai", "OAuth", "API Key", "不再是唯一"):
            with self.subTest(decision=decision):
                self.assertIn(decision, decisions)
        self.assertIn("取消收藏後是否重新保留 14 天，仍待產品確認", self.document)

    def test_subscription_and_api_failure_acceptance_are_documented(self):
        self.assertIn("https://ai.google.dev/gemini-api/docs/pricing", self.document)
        self.assertIn("https://ai.google.dev/gemini-api/docs/rate-limits", self.document)
        acceptance = self.document.split("## 7. 後續功能驗收與測試\n", 1)[1].split("## 8.", 1)[0]
        for scenario in ("不同帳號", "429", "14 天", "API Key", "已保存收藏", "訂閱登入", "Token 到期", "解除連接", "雲端回呼"):
            with self.subTest(scenario=scenario):
                self.assertIn(scenario, acceptance)

    def test_subscription_credentials_and_google_api_are_distinguished(self):
        self.assertIn("#oauth-providers", self.document)
        self.assertIn("#credential-store", self.document)
        self.assertIn("Google AI Studio 免費 API 仍使用 API Key", self.document)
        self.assertIn("不能假設 Google AI Pro/Ultra 訂閱", self.document)
        self.assertIn("產品帳號登入與模型供應商授權為兩個獨立流程", self.document)
        self.assertIn("依使用者及供應商隔離", self.document)
        self.assertIn("刷新失敗時提示重新授權", self.document)
        self.assertIn("不靜默改用其他帳號或付費 API", self.document)


if __name__ == "__main__":
    unittest.main()
