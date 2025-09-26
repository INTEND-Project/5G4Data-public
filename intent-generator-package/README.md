# Intent Generator Package

A Python package for generating TM Forum formatted intents for 5G network and workload management scenarios. This package provides a clean, modular API for creating network slice configuration intents, workload deployment intents, and combined intents.

## Features

- **Network Intent Generation**: Create network slice configuration intents with QoS guarantees (latency, bandwidth)
- **Workload Intent Generation**: Generate workload deployment intents for cloud-native applications
- **Combined Intent Generation**: Create intents that simultaneously configure network slices and deploy applications
- **Geographic Support**: Automatic polygon generation from location names using OpenAI API
- **Flexible Parameters**: Support for various operators (smaller, larger, inRange, etc.)
- **Clean API**: Type-safe parameter classes and intuitive method signatures
- **Command-line Interface**: Generate intents from the command line
- **RDF/Turtle Output**: Generate standards-compliant TM Forum intent documents

## Installation

```bash
pip install intent-generator
```

## Quick Start

### Basic Usage

```python
from intent_generator import IntentGenerator, NetworkIntentParams

# Create generator
generator = IntentGenerator()

# Generate network intent
params = NetworkIntentParams(
    latency=20,
    bandwidth=300,
    location="Oslo, Norway",
    handler="inSwitch",
    owner="inNet"
)
intent_turtle = generator.generate_network_intent(params)
print(intent_turtle)
```

### Generate Different Intent Types

```python
from intent_generator import IntentGenerator, WorkloadIntentParams, CombinedIntentParams

generator = IntentGenerator()

# Workload intent
workload_params = WorkloadIntentParams(
    compute_latency=15,
    datacenter="EC1",
    application="AR-retail-app"
)
workload_intent = generator.generate_workload_intent(workload_params)

# Combined intent
combined_params = CombinedIntentParams(
    latency=20,
    bandwidth=300,
    compute_latency=15,
    location="Oslo, Norway",
    datacenter="EC1"
)
combined_intent = generator.generate_combined_intent(combined_params)
```

### Using the Generic Generate Method

```python
from intent_generator import IntentGenerator, IntentType, NetworkIntentParams

generator = IntentGenerator()

# Using enum
params = NetworkIntentParams(latency=25, bandwidth=500)
intent = generator.generate(IntentType.NETWORK, params)

# Using string
intent = generator.generate("network", params)

# Using dictionary
intent = generator.generate("network", {
    "latency": 25,
    "bandwidth": 500,
    "location": "Stockholm, Sweden"
})
```

## Parameter Classes

### NetworkIntentParams

Parameters for network slice configuration intents:

```python
@dataclass
class NetworkIntentParams(BaseIntentParams):
    latency: float = 20.0
    latency_operator: str = "smaller"  # smaller, atLeast, atMost, greater, inRange, mean, median
    latency_end: Optional[float] = None  # Required for inRange operator
    bandwidth: float = 300.0
    bandwidth_operator: str = "larger"  # larger, atLeast, atMost, greater, inRange, mean, median
    bandwidth_end: Optional[float] = None  # Required for inRange operator
    location: Optional[str] = None  # Location name for automatic polygon generation
    polygon: Optional[str] = None  # WKT polygon string (overrides location)
    description: Optional[str] = None
    handler: Optional[str] = None
    owner: Optional[str] = None
    customer: str = "+47 90914547"
```

### WorkloadIntentParams

Parameters for workload deployment intents:

```python
@dataclass
class WorkloadIntentParams(BaseIntentParams):
    compute_latency: float = 20.0
    compute_latency_operator: str = "smaller"
    compute_latency_end: Optional[float] = None
    datacenter: str = "EC1"
    application: str = "AR-retail-app"
    descriptor: str = "http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml"
    description: Optional[str] = None
    handler: Optional[str] = None
    owner: Optional[str] = None
    customer: str = "+47 90914547"
```

### CombinedIntentParams

Parameters for combined network and workload intents (includes all parameters from both types).

## Command Line Interface

Generate intents from the command line:

```bash
# Generate network intent with default parameters
intent-generator network

# Generate with custom parameters
intent-generator network --params '{"latency": 25, "bandwidth": 500, "location": "Oslo, Norway"}'

# Generate from parameter file
intent-generator network --params-file params.json

# Generate multiple intents
intent-generator network --count 5 --interval 1.0

# Save to file
intent-generator network --output network_intent.ttl
```

### Parameter File Format

Create a JSON file with parameters:

```json
{
    "latency": 25,
    "bandwidth": 500,
    "latency_operator": "smaller",
    "bandwidth_operator": "larger",
    "location": "Oslo, Norway",
    "handler": "inSwitch",
    "owner": "inNet",
    "description": "High-performance network slice for AR application"
}
```

## Advanced Usage

### Custom Polygon Generation

```python
from intent_generator import IntentGenerator, NetworkIntentParams
from intent_generator.utils import get_polygon_from_location

# Manual polygon generation
polygon = get_polygon_from_location("Oslo, Norway")

params = NetworkIntentParams(
    polygon=polygon,  # Use custom polygon
    latency=20,
    bandwidth=300
)
```

### Range Conditions

```python
params = NetworkIntentParams(
    latency=10,
    latency_operator="inRange",
    latency_end=30,  # Latency between 10-30ms
    bandwidth=200,
    bandwidth_operator="inRange", 
    bandwidth_end=500  # Bandwidth between 200-500 mbit/s
)
```

### Sequence Generation

```python
# Generate multiple intents with intervals
intents = generator.generate_sequence(
    IntentType.NETWORK,
    params,
    count=5,
    interval=2.0  # 2 seconds between generations
)
```

## Environment Variables

- `OPENAI_API_KEY`: Required for automatic location-to-polygon conversion

## Integration with MCP Projects

This package is designed to be easily integrated into Model Context Protocol (MCP) projects:

```python
# In your MCP server
from intent_generator import IntentGenerator, NetworkIntentParams

class IntentMCPServer:
    def __init__(self):
        self.generator = IntentGenerator()
    
    def create_network_intent(self, params_dict):
        params = NetworkIntentParams(**params_dict)
        return self.generator.generate_network_intent(params)
    
    def create_workload_intent(self, params_dict):
        params = WorkloadIntentParams(**params_dict)
        return self.generator.generate_workload_intent(params)
```

## Output Format

The package generates TM Forum compliant RDF/Turtle documents. Example output:

```turtle
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .

data5g:I1a2b3c4d a icm:Intent ;
    log:allOf data5g:NE1a2b3c4d,
        data5g:RE1a2b3c4d .

data5g:NE1a2b3c4d a data5g:NetworkExpectation ;
    icm:target data5g:network-slice ;
    log:allOf data5g:CO1a2b3c4d,
        data5g:CO2a2b3c4d .
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions, please open an issue on the GitHub repository.
