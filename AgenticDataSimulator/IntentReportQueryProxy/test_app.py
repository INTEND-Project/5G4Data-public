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


class PrometheusQueryUrlTests(unittest.TestCase):
    def test_rewrite_public_url_to_executor(self):
        stored = (
            "https://start5g-1.cs.uit.no/prometheus/api/v1/query?"
            "query=energyconsumption_COf1%7Bjob%3D%22intent_reports%22%7D"
        )
        with patch.object(proxy, "PROMETHEUS_EXECUTOR_URL", "http://127.0.0.1:9090"):
            rewritten = proxy.rewrite_prometheus_query_url(stored)
        self.assertTrue(rewritten.startswith("http://127.0.0.1:9090/api/v1/query?"))
        self.assertIn("query=energyconsumption", rewritten)

    def test_choose_local_url_over_docker_internal(self):
        urls = [
            "http://host.docker.internal:9090/api/v1/query?query=up",
            "http://127.0.0.1:9090/prometheus/api/v1/query?query=up",
        ]
        self.assertEqual(
            proxy.choose_stored_prometheus_query_url(urls),
            urls[1],
        )

    def test_detects_https_prometheus_without_port_9090(self):
        self.assertTrue(
            proxy.is_prometheus_query_url(
                "https://start5g-1.cs.uit.no/prometheus/api/v1/query?query=up"
            )
        )

    def test_external_partner_url_not_rewritten(self):
        stored = (
            "https://partner-prometheus.example/api/v1/query?"
            "query=energyconsumption_COf1%7Bjob%3D%22intent_reports%22%7D"
        )
        with patch.object(proxy, "PROMETHEUS_EXECUTOR_URL", "http://127.0.0.1:9090"):
            rewritten = proxy.rewrite_prometheus_query_url(stored)
        self.assertEqual(rewritten, stored)


class PrometheusStepParsingTests(unittest.TestCase):
    def test_parse_duration_units(self):
        self.assertEqual(proxy.parse_prometheus_step_to_seconds('60s'), 60)
        self.assertEqual(proxy.parse_prometheus_step_to_seconds('6h'), 6 * 3600)
        self.assertEqual(proxy.parse_prometheus_step_to_seconds('30m'), 1800)

    def test_resolve_honors_grafana_step_for_long_range(self):
        # ~167 days; 6h step => ~668 points (under Prometheus limit)
        time_range = 14442120
        resolved = proxy.resolve_prometheus_step('6h', time_range)
        self.assertEqual(resolved, '6h')

    def test_resolve_auto_increases_step_when_too_many_points(self):
        time_range = 14442120
        resolved = proxy.resolve_prometheus_step('60s', time_range)
        self.assertEqual(proxy.parse_prometheus_step_to_seconds(resolved), 1445)


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
