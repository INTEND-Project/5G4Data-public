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


class LegacyApiDetectionTests(unittest.TestCase):
    def test_missing_repository_param_is_legacy(self):
        self.assertTrue(proxy.is_legacy_api_request(None))
        self.assertTrue(proxy.is_legacy_api_request(""))
        self.assertTrue(proxy.is_legacy_api_request("   "))

    def test_repository_param_is_not_legacy(self):
        self.assertFalse(proxy.is_legacy_api_request("telenor-5g4data-simulator-demo"))


class FormatTimestampValueTests(unittest.TestCase):
    def test_legacy_uses_iso_strings(self):
        value = proxy.format_timestamp_value("1779339649", legacy_api=True)
        self.assertIsInstance(value, str)
        self.assertIn("2026", value)

    def test_modern_uses_epoch_milliseconds(self):
        value = proxy.format_timestamp_value("1779339649", legacy_api=False)
        self.assertEqual(value, 1779339649000)


class FormatForGrafanaInfinityTests(unittest.TestCase):
    def test_legacy_api_returns_iso_timestamps(self):
        rows = proxy.format_for_grafana_infinity({
            'results': {
                'bindings': [
                    {'timestamp': {'value': '1779339649'}, 'value': {'value': '100'}},
                ],
            },
        }, legacy_api=True)
        self.assertIsInstance(rows[0]['timestamp'], str)

    def test_modern_api_returns_epoch_milliseconds(self):
        rows = proxy.format_for_grafana_infinity({
            'results': {
                'bindings': [
                    {'timestamp': {'value': '1779339649'}, 'value': {'value': '100'}},
                ],
            },
        }, legacy_api=False)
        self.assertEqual(rows[0]['timestamp'], 1779339649000)


if __name__ == "__main__":
    unittest.main()
