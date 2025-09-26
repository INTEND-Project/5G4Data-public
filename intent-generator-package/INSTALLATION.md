# Installation and Usage Guide

## Installation

### From Source (Development)

1. Clone or copy the package directory:
```bash
cd /path/to/your/projects
cp -r intent-generator-package my-intent-generator
cd my-intent-generator
```

2. Install in development mode:
```bash
pip install -e .
```

### For MCP Integration

1. Copy the package to your MCP project:
```bash
# In your MCP project directory
cp -r /path/to/intent-generator-package ./intent_generator
```

2. Install dependencies:
```bash
pip install -r intent_generator/requirements.txt
```

3. Use in your MCP server:
```python
import sys
sys.path.append('./intent_generator')

from intent_generator import IntentGenerator, NetworkIntentParams

# Your MCP server code here
```

## Quick Test

Run the example script to verify everything works:

```bash
cd intent-generator-package
python example.py
```

## MCP Integration Example

Here's how to integrate this package into your MCP project:

```python
# mcp_server.py
from intent_generator import IntentGenerator, NetworkIntentParams, WorkloadIntentParams, CombinedIntentParams

class IntentMCPServer:
    def __init__(self):
        self.generator = IntentGenerator()
    
    def create_network_intent(self, params):
        """Create a network intent via MCP."""
        if isinstance(params, dict):
            params = NetworkIntentParams(**params)
        return self.generator.generate_network_intent(params)
    
    def create_workload_intent(self, params):
        """Create a workload intent via MCP."""
        if isinstance(params, dict):
            params = WorkloadIntentParams(**params)
        return self.generator.generate_workload_intent(params)
    
    def create_combined_intent(self, params):
        """Create a combined intent via MCP."""
        if isinstance(params, dict):
            params = CombinedIntentParams(**params)
        return self.generator.generate_combined_intent(params)
    
    def generate_intent_sequence(self, intent_type, params, count=1, interval=0):
        """Generate multiple intents."""
        return self.generator.generate_sequence(intent_type, params, count, interval)

# Usage in your MCP handlers
server = IntentMCPServer()

# Example MCP handler
def handle_create_network_intent(params):
    return server.create_network_intent(params)
```

## Environment Setup

Make sure to set the OpenAI API key for location-to-polygon conversion:

```bash
export OPENAI_API_KEY="your-api-key-here"
```

## Package Structure

```
intent-generator-package/
├── setup.py                 # Package setup
├── pyproject.toml           # Modern Python packaging
├── requirements.txt         # Dependencies
├── README.md               # Documentation
├── LICENSE                 # MIT License
├── MANIFEST.in            # Package manifest
├── example.py              # Usage examples
├── intent_generator/       # Main package
│   ├── __init__.py        # Package exports
│   ├── core.py            # IntentGenerator class
│   ├── models.py          # Parameter classes
│   ├── utils.py           # Utility functions
│   └── cli.py             # Command-line interface
└── tests/                 # Test suite
    ├── __init__.py
    └── test_core.py       # Unit tests
```

## Key Features

✅ **Clean API**: Type-safe parameter classes  
✅ **Multiple Intent Types**: Network, Workload, Combined  
✅ **Flexible Parameters**: Support for various operators  
✅ **Geographic Support**: Automatic polygon generation  
✅ **Command-line Interface**: Generate intents from CLI  
✅ **MCP Ready**: Easy integration with MCP projects  
✅ **Well Tested**: Comprehensive test suite  
✅ **Documented**: Complete documentation and examples  

## Next Steps

1. **Test the package**: Run `python example.py` to see it in action
2. **Integrate with MCP**: Use the integration example above
3. **Customize**: Modify parameters and add new intent types as needed
4. **Deploy**: Install in your MCP project environment

The package is now ready for use in your MCP project! 🚀
