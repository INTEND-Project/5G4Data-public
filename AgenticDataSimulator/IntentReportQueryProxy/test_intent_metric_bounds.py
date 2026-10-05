import unittest

from intent_metric_bounds import (
    close_bounds_for_grafana,
    extract_metric_bounds_from_turtle,
    grafana_open_lower,
    grafana_open_upper,
)

FIXTURE = """
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .

data5g:Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a icm:Intent ;
  log:allOf data5g:CX1 .

data5g:CX1 a icm:Expectation ;
  log:allOf ( data5g:COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
              data5g:CObbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
              data5g:COcccccccccccccccccccccccccccccccc ) .

data5g:COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a icm:Condition ;
  set:forAll (
    [ icm:valuesOfTargetProperty data5g:p99-token-target ]
    [ quan:atLeast ( [ rdf:value 250 ] ) ]
  ) .

data5g:CObbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb a icm:Condition ;
  set:forAll (
    [ icm:valuesOfTargetProperty data5g:energy-consumption ]
    [ quan:smaller ( [ rdf:value 120 ] ) ]
  ) .

data5g:COcccccccccccccccccccccccccccccccc a icm:Condition ;
  set:forAll (
    [ icm:valuesOfTargetProperty data5g:power-consumption ]
    [ quan:smaller ( [ rdf:value 70 ] ) ]
  ) .
""".strip()


class ExtractMetricBoundsTests(unittest.TestCase):
    def test_p99_floor_only(self):
        bounds = extract_metric_bounds_from_turtle(
            FIXTURE,
            "p99-token-target_COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )
        self.assertEqual(bounds, {"value1": 250.0})

    def test_energy_ceiling_only(self):
        bounds = extract_metric_bounds_from_turtle(
            FIXTURE,
            "energy-consumption_CObbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        )
        self.assertEqual(bounds, {"value2": 120.0})

    def test_power_ceiling_by_stem(self):
        bounds = extract_metric_bounds_from_turtle(FIXTURE, "power-consumption")
        self.assertEqual(bounds, {"value2": 70.0})

    def test_unknown_metric(self):
        self.assertIsNone(extract_metric_bounds_from_turtle(FIXTURE, "latency_COffffffffffffffffffffffffffffffff"))

    def test_close_bounds_floor_gets_red_rail_and_open_upper(self):
        self.assertEqual(
            close_bounds_for_grafana({"value1": 250.0}),
            {
                "value0": grafana_open_lower(250.0),
                "value1": 250.0,
                "value2": grafana_open_upper(250.0),
            },
        )

    def test_close_bounds_ceiling_gets_open_lower_without_value0(self):
        self.assertEqual(
            close_bounds_for_grafana({"value2": 120.0}),
            {"value1": grafana_open_lower(120.0), "value2": 120.0},
        )

    def test_close_bounds_in_range_gets_lower_red_rail(self):
        self.assertEqual(
            close_bounds_for_grafana({"value1": 10.0, "value2": 20.0}),
            {
                "value0": grafana_open_lower(10.0),
                "value1": 10.0,
                "value2": 20.0,
            },
        )


if __name__ == "__main__":
    unittest.main()
