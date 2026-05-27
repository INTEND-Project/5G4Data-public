import unittest
from unittest.mock import patch

import app as proxy


class ResolveRepositoryIdTests(unittest.TestCase):
    def test_uses_request_repository_id(self):
        with patch.object(proxy, "REPOSITORY", "fallback-repo"):
            repo, err = proxy.resolve_repository_id("telenor-5g4data-simulator-demo")
        self.assertIsNone(err)
        self.assertEqual(repo, "telenor-5g4data-simulator-demo")

    def test_falls_back_to_env_default(self):
        with patch.object(proxy, "REPOSITORY", "intents_and_intent_reports"):
            repo, err = proxy.resolve_repository_id(None)
        self.assertIsNone(err)
        self.assertEqual(repo, "intents_and_intent_reports")

    def test_rejects_invalid_repository_id(self):
        repo, err = proxy.resolve_repository_id("bad repo!")
        self.assertIsNone(repo)
        self.assertEqual(err, "Invalid repository_id")


if __name__ == "__main__":
    unittest.main()
