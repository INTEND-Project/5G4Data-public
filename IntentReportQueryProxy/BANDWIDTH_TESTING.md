# Bandwidth Metrics Testing

This document describes the comprehensive testing suite for bandwidth metrics with time constraints in the Intent Report Query Proxy.

## Overview

The testing suite includes several types of tests specifically designed to validate bandwidth metrics functionality with time constraints:

1. **Time Constraint Tests** - Tests various time windows and ranges
2. **Data Validation Tests** - Validates response structure and data format
3. **Prometheus Query Tests** - Tests Prometheus-style queries with time ranges

## Test Categories

### 1. Time Constraint Tests

Tests bandwidth metrics with various time windows:

- **Last 1 hour** - Tests recent data retrieval
- **Last 6 hours** - Tests medium-term data retrieval
- **Last 24 hours** - Tests long-term data retrieval
- **Specific ISO window** - Tests with ISO format timestamps
- **Short time window (5 minutes)** - Tests high-resolution data
- **Future time window** - Tests edge case with future timestamps
- **Very old time window** - Tests edge case with historical data

### 2. Data Validation Tests

Validates the structure and format of bandwidth metric responses:

- **Response structure** - Checks for required fields (data, meta, metric_name, query)
- **Data format** - Validates timestamp and value fields in response data
- **Time range consistency** - Ensures time range parameters are properly handled

### 3. Prometheus Query Tests

Tests Prometheus-style queries specifically:

- **Instant query** - Tests query without time range
- **Range query (short)** - Tests 5-minute time window
- **Range query (medium)** - Tests 1-hour time window
- **Range query (ISO)** - Tests with ISO format timestamps
- **Query conversion** - Validates that instant queries are converted to range queries

### 4. Step Parameter Tests

Tests the step parameter functionality for Prometheus queries:

- **Default step (60s)** - Tests default step value when no step is provided
- **Custom step (30s)** - Tests custom 30-second step
- **Custom step (5m)** - Tests custom 5-minute step
- **Custom step (1h)** - Tests custom 1-hour step
- **Step without time range** - Tests step parameter behavior without time range

## Running the Tests

### Using the Test Script

```bash
# Run all tests including bandwidth metrics
./run_tests.sh
```

### Using Python Directly

```bash
# Run comprehensive test suite
python test_app.py --url http://localhost:3010

# Run with custom wait time
python test_app.py --url http://localhost:3010 --wait 5
```

### Manual Testing

You can also test specific bandwidth metrics manually:

```bash
# Test bandwidth metric without time range
curl "http://localhost:3010/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1"

# Test bandwidth metric with time range (last hour)
curl "http://localhost:3010/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1?start=1640995200&end=1641081600"

# Test bandwidth metric with ISO timestamps
curl "http://localhost:3010/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1?start=2025-01-01T00:00:00Z&end=2025-01-01T01:00:00Z"

# Test bandwidth metric with custom step parameter
curl "http://localhost:3010/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1?start=1640995200&end=1641081600&step=30s"

# Test bandwidth metric with different step values
curl "http://localhost:3010/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1?start=1640995200&end=1641081600&step=5m"
curl "http://localhost:3010/api/get-metric-reports/bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1?start=1640995200&end=1641081600&step=1h"
```

## Expected Results

### Successful Tests Should Show:

1. **Time Constraint Tests**: All time windows should return appropriate data
2. **Data Validation Tests**: Response should have proper structure and format
3. **Prometheus Tests**: Queries should be converted to range queries when time parameters are provided

### Key Validation Points:

- ✅ Response contains `data` and `meta` fields
- ✅ Time range parameters are properly converted (ISO to Unix timestamps)
- ✅ Prometheus queries are converted from instant to range queries
- ✅ Multiple data points are returned for time range queries
- ✅ Timestamps are properly formatted for Grafana
- ✅ Step parameter is properly handled and included in response metadata
- ✅ Custom step values (30s, 5m, 1h) are correctly applied to Prometheus queries

## Troubleshooting

### Common Issues:

1. **No data returned**: Check if the bandwidth metric exists in GraphDB
2. **Time range not working**: Verify that the underlying Prometheus query supports time ranges
3. **Conversion errors**: Check that timestamps are in the expected format

### Debug Information:

The test suite provides detailed logging for:
- Query modifications
- Response structure
- Data point counts
- Timestamp conversions

## Test Metrics

The tests use the following bandwidth metric:
- **Metric ID**: `bandwidth_co_c974e3bf6bae4c54a428b3d15e2e5dc1`
- **Type**: Bandwidth constraint metric
- **Data Source**: Prometheus (with time range support)

## Integration with Grafana

These tests validate that the bandwidth metrics work correctly with Grafana Infinity data source, ensuring:

- Proper time series data format
- Correct timestamp handling
- Multiple data points for visualization
- Time range parameter support 