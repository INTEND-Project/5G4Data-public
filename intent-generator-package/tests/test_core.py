"""Tests for intent generator package."""

import pytest
from intent_generator import IntentGenerator, NetworkIntentParams, WorkloadIntentParams, CombinedIntentParams, IntentType


class TestIntentGenerator:
    """Test cases for IntentGenerator class."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.generator = IntentGenerator()
    
    def test_network_intent_generation(self):
        """Test network intent generation."""
        params = NetworkIntentParams(
            latency=20,
            bandwidth=300,
            handler="testHandler",
            owner="testOwner"
        )
        
        result = self.generator.generate_network_intent(params)
        
        assert isinstance(result, str)
        assert "@prefix" in result
        assert "icm:Intent" in result
        assert "data5g:NetworkExpectation" in result
        assert "icm:IntentElement" in result
        assert "icm:Expectation" in result
        assert "testHandler" in result
        assert "testOwner" in result
    
    def test_workload_intent_generation(self):
        """Test workload intent generation."""
        params = WorkloadIntentParams(
            compute_latency=15,
            datacenter="EC1",
            application="test-app"
        )
        
        result = self.generator.generate_workload_intent(params)
        
        assert isinstance(result, str)
        assert "@prefix" in result
        assert "icm:Intent" in result
        assert "data5g:DeploymentExpectation" in result
        assert "icm:IntentElement" in result
        assert "icm:Expectation" in result
        assert "EC1" in result
        assert "test-app" in result
    
    def test_combined_intent_generation(self):
        """Test combined intent generation."""
        params = CombinedIntentParams(
            latency=20,
            bandwidth=300,
            compute_latency=15,
            datacenter="EC1"
        )
        
        result = self.generator.generate_combined_intent(params)
        
        assert isinstance(result, str)
        assert "@prefix" in result
        assert "icm:Intent" in result
        assert "data5g:NetworkExpectation" in result
        assert "data5g:DeploymentExpectation" in result
        assert "icm:IntentElement" in result
        assert "icm:Expectation" in result
    
    def test_generate_with_enum(self):
        """Test generate method with IntentType enum."""
        params = NetworkIntentParams(latency=25, bandwidth=500)
        result = self.generator.generate(IntentType.NETWORK, params)
        
        assert isinstance(result, str)
        assert "icm:Intent" in result
    
    def test_generate_with_string(self):
        """Test generate method with string type."""
        params = {"latency": 25, "bandwidth": 500}
        result = self.generator.generate("network", params)
        
        assert isinstance(result, str)
        assert "icm:Intent" in result
    
    def test_generate_sequence(self):
        """Test sequence generation."""
        params = NetworkIntentParams(latency=20, bandwidth=300)
        results = self.generator.generate_sequence("network", params, count=3)
        
        assert len(results) == 3
        for result in results:
            assert isinstance(result, str)
            assert "icm:Intent" in result
    
    def test_invalid_intent_type(self):
        """Test error handling for invalid intent type."""
        params = NetworkIntentParams()
        
        with pytest.raises(ValueError, match="Unknown intent type"):
            self.generator.generate("invalid_type", params)
    
    def test_range_conditions(self):
        """Test inRange operator conditions."""
        params = NetworkIntentParams(
            latency=10,
            latency_operator="inRange",
            latency_end=30,
            bandwidth=200,
            bandwidth_operator="inRange",
            bandwidth_end=500
        )
        
        result = self.generator.generate_network_intent(params)
        
        assert isinstance(result, str)
        assert "quan:inRange" in result
        assert "10" in result
        assert "30" in result
        assert "200" in result
        assert "500" in result
    
    def test_intent_description(self):
        """Test intent_description parameter."""
        params = NetworkIntentParams(
            latency=20,
            bandwidth=300,
            intent_description="Test intent description"
        )
        
        result = self.generator.generate_network_intent(params)
        
        assert isinstance(result, str)
        assert "Test intent description" in result
        assert "dct:description" in result
        
        # Check that the description is on the intent itself, not just expectations
        lines = result.split('\n')
        intent_lines = [line for line in lines if 'icm:Intent' in line]
        assert len(intent_lines) > 0
        
        # Find lines with intent description (could be on same line or following line)
        intent_with_desc = [line for line in lines if 'icm:Intent' in line and 'dct:description' in line]
        if len(intent_with_desc) == 0:
            # Check if description is on the line following the intent declaration
            for i, line in enumerate(lines):
                if 'icm:Intent' in line and i + 1 < len(lines):
                    next_line = lines[i + 1]
                    if 'dct:description' in next_line and 'Test intent description' in next_line:
                        intent_with_desc = [next_line]
                        break
        
        assert len(intent_with_desc) > 0


class TestParameterClasses:
    """Test cases for parameter classes."""
    
    def test_network_intent_params_defaults(self):
        """Test NetworkIntentParams default values."""
        params = NetworkIntentParams()
        
        assert params.latency == 20.0
        assert params.bandwidth == 300.0
        assert params.latency_operator == "smaller"
        assert params.bandwidth_operator == "larger"
        assert params.customer == "+47 90914547"
    
    def test_workload_intent_params_defaults(self):
        """Test WorkloadIntentParams default values."""
        params = WorkloadIntentParams()
        
        assert params.compute_latency == 20.0
        assert params.datacenter == "EC1"
        assert params.application == "AR-retail-app"
        assert params.compute_latency_operator == "smaller"
    
    def test_combined_intent_params_defaults(self):
        """Test CombinedIntentParams default values."""
        params = CombinedIntentParams()
        
        assert params.latency == 20.0
        assert params.bandwidth == 300.0
        assert params.compute_latency == 20.0
        assert params.datacenter == "EC1"
    
    def test_parameter_validation(self):
        """Test parameter validation."""
        # This would test any validation logic if added
        params = NetworkIntentParams(latency=-10)  # Invalid negative latency
        # Currently no validation, but this is where it would be tested
        assert params.latency == -10  # Should still work as no validation yet


class TestUtilityFunctions:
    """Test cases for utility functions."""
    
    def test_get_default_polygon(self):
        """Test default polygon generation."""
        from intent_generator.utils import get_default_polygon
        
        polygon = get_default_polygon()
        assert isinstance(polygon, str)
        assert "POLYGON" in polygon
    
    def test_operator_mapping(self):
        """Test operator mapping."""
        from intent_generator.utils import get_operator_mapping
        
        mapping = get_operator_mapping()
        assert "smaller" in mapping
        assert "larger" in mapping
        assert "inRange" in mapping
        assert "atLeast" in mapping
        assert "atMost" in mapping
        assert "greater" in mapping
        assert "mean" in mapping
        assert "median" in mapping


if __name__ == "__main__":
    pytest.main([__file__])
