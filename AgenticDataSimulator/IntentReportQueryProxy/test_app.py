import unittest
from unittest.mock import Mock, patch

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

    def test_resolve_honors_native_step_for_long_range(self):
        time_range = 3_196_800  # 37 days
        resolved = proxy.resolve_requested_prometheus_step('300s', time_range)
        self.assertEqual(resolved, '5m')

    def test_estimate_points_for_five_minute_window(self):
        time_range = 3_196_800
        self.assertEqual(proxy.estimate_prometheus_range_points(time_range, 300), 10_657)

    def test_chunk_ranges_for_sixty_second_window(self):
        start = 1_776_229_200
        end = start + 3_196_800
        ranges = proxy.compute_prometheus_chunk_epoch_ranges(start, end, 60)
        self.assertGreaterEqual(len(ranges), 5)
        total_points = 0
        for chunk_start, chunk_end in ranges:
            total_points += proxy.estimate_prometheus_range_points(chunk_end - chunk_start, 60)
        self.assertGreaterEqual(total_points, 53_000)

    def test_merge_prometheus_matrix_dedupes_timestamps(self):
        merged = proxy.merge_prometheus_matrix_values([
            {'values': [[100, '1'], [160, '2']], 'metric': {'__name__': 'm'}},
            {'values': [[160, '2b'], [220, '3']], 'metric': {'__name__': 'm'}},
        ])
        self.assertEqual(merged['values'], [[100, '1'], [160, '2b'], [220, '3']])


class PrometheusRangeExecutionTests(unittest.TestCase):
    def test_clamps_start_when_initial_range_empty(self):
        base = 'http://127.0.0.1:9090/api/v1/query?query=powerconsumption_test'
        empty_payload = {'status': 'success', 'data': {'result': []}}
        probe_payload = {
            'status': 'success',
            'data': {
                'result': [{
                    'metric': {'__name__': 'powerconsumption_test'},
                    'values': [[1776229200, '5']],
                }],
            },
        }
        chunk_payload = {
            'status': 'success',
            'data': {
                'result': [{
                    'metric': {'__name__': 'powerconsumption_test'},
                    'values': [[1776229200, '5'], [1776229560, '6']],
                }],
            },
        }

        with patch('app.requests.get') as mock_get:
            mock_get.side_effect = [
                Mock(status_code=200, json=lambda: empty_payload),
                Mock(status_code=200, json=lambda: probe_payload),
                Mock(status_code=200, json=lambda: chunk_payload),
            ]
            result = proxy.execute_prometheus_observation_query(
                base,
                '2026-04-13T09:35:03Z',
                '2026-05-24T01:17:03Z',
                '360s',
            )

        self.assertIsNotNone(result)
        bindings = result['results']['bindings']
        self.assertEqual(len(bindings), 2)
        self.assertEqual(mock_get.call_count, 3)


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


class GetIntentParamTests(unittest.TestCase):
    def test_normalize_intent_id_lowercases_hex(self):
        self.assertEqual(
            proxy.normalize_intent_id("IB16BBF1BF2A541B887B94E2B73CF10DC"),
            "Ib16bbf1bf2a541b887b94e2b73cf10dc",
        )

    def test_normalize_intent_id_rejects_invalid(self):
        self.assertIsNone(proxy.normalize_intent_id("not-an-intent"))

    def test_validate_get_intent_params_ok(self):
        params, err = proxy.validate_get_intent_params(
            "Ib16bbf1bf2a541b887b94e2b73cf10dc",
            "urn:intend:kg:telenor-5g4data:arneme:test",
        )
        self.assertIsNone(err)
        self.assertEqual(params["intent_id"], "Ib16bbf1bf2a541b887b94e2b73cf10dc")
        self.assertEqual(params["graph_iri"], "urn:intend:kg:telenor-5g4data:arneme:test")

    def test_validate_get_intent_params_rejects_bad_graph(self):
        params, err = proxy.validate_get_intent_params(
            "Ib16bbf1bf2a541b887b94e2b73cf10dc",
            "http://example.com/not-a-kg-iri",
        )
        self.assertIsNone(params)
        self.assertEqual(err, "Invalid graph_iri")


class IntentTurtleConstructTests(unittest.TestCase):
    def test_build_intent_turtle_construct_query_scopes_named_graph(self):
        query = proxy.build_intent_turtle_construct_query(
            "urn:intend:kg:telenor-5g4data:arneme:test",
            "Ib16bbf1bf2a541b887b94e2b73cf10dc",
        )
        self.assertIn("GRAPH <urn:intend:kg:telenor-5g4data:arneme:test>", query)
        self.assertIn(
            "<http://5g4data.eu/5g4data#Ib16bbf1bf2a541b887b94e2b73cf10dc>",
            query,
        )
        self.assertIn("CONSTRUCT", query)


class FormatIntentTurtleTests(unittest.TestCase):
    EXPANDED_LIST_TURTLE = """
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
<http://5g4data.eu/5g4data#Ib16bbf1bf2a541b887b94e2b73cf10dc>
  a <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/Intent> ;
  <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/allOf> _:l0 .
_:l0 rdf:first <http://5g4data.eu/5g4data#CE1> ;
     rdf:rest _:l1 .
_:l1 rdf:first <http://5g4data.eu/5g4data#CE2> ;
     rdf:rest rdf:nil .
<http://5g4data.eu/5g4data#CE1> a <http://5g4data.eu/5g4data#DeploymentExpectation> .
<http://5g4data.eu/5g4data#CE2> a <http://5g4data.eu/5g4data#NetworkExpectation> .
""".strip()

    def test_format_intent_turtle_collapses_lists_and_prefixes(self):
        formatted = proxy.format_intent_turtle(self.EXPANDED_LIST_TURTLE)
        self.assertIn("@prefix data5g:", formatted)
        self.assertIn("icm:Intent", formatted)
        self.assertIn("data5g:Ib16bbf1bf2a541b887b94e2b73cf10dc", formatted)
        self.assertIn("log:allOf", formatted)
        self.assertRegex(formatted, r"log:allOf\s*\(")
        self.assertNotIn("_:l0", formatted)
        self.assertNotIn("_:l1", formatted)
        self.assertNotIn("http://5g4data.eu/5g4data#Ib16bbf1bf2a541b887b94e2b73cf10dc", formatted)

    def test_format_intent_turtle_returns_raw_on_invalid_input(self):
        invalid = "@prefix data5g: <http://5g4data.eu/5g4data#> . data5g:Ix a icm:Intent [ unclosed ."
        self.assertEqual(proxy.format_intent_turtle(invalid), invalid)

    def test_format_intent_turtle_empty(self):
        self.assertEqual(proxy.format_intent_turtle(""), "")
        self.assertEqual(proxy.format_intent_turtle("   "), "")


class BoundsSparqlTests(unittest.TestCase):
    def test_build_bounds_sparql_uses_rdf_list_unwrapping(self):
        query = proxy.build_bounds_sparql(
            "Ib16bbf1bf2a541b887b94e2b73cf10dc",
            "p99-token-target_COc1a1d75bb4b745ec932ee49120a1e9ab",
            "urn:intend:kg:telenor-5g4data:arneme:test",
        )
        self.assertIn("rdf:rest*/rdf:first", query)
        self.assertIn("log:Condition", query)
        self.assertIn("quan:greater", query)
        self.assertIn("GRAPH <urn:intend:kg:telenor-5g4data:arneme:test>", query)


class GetIntentRouteTests(unittest.TestCase):
    def test_get_intent_returns_turtle_json(self):
        client = proxy.app.test_client()
        with patch.object(
            proxy,
            "fetch_intent_turtle",
            return_value=("@prefix data5g: <http://5g4data.eu/5g4data#> .\n", None),
        ):
            response = client.get(
                "/api/get-intent/Ib16bbf1bf2a541b887b94e2b73cf10dc"
                "?repository_id=telenor-5g4data-arneme-test"
                "&graph_iri=urn:intend:kg:telenor-5g4data:arneme:test"
            )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["intent_id"], "Ib16bbf1bf2a541b887b94e2b73cf10dc")
        self.assertIn("@prefix data5g:", payload["data"])

    def test_get_intent_requires_graph_iri(self):
        client = proxy.app.test_client()
        response = client.get(
            "/api/get-intent/Ib16bbf1bf2a541b887b94e2b73cf10dc"
            "?repository_id=telenor-5g4data-arneme-test"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Invalid graph_iri")


if __name__ == "__main__":
    unittest.main()
