"""Command-line interface for intent generation."""

import argparse
import json
import sys
from typing import Dict, Any

from .core import IntentGenerator
from .models import NetworkIntentParams, WorkloadIntentParams, CombinedIntentParams, IntentType


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(description="Generate TM Forum formatted intents")
    parser.add_argument("type", choices=["network", "workload", "combined"], help="Type of intent to generate")
    parser.add_argument("--params", type=str, help="JSON string of parameters")
    parser.add_argument("--params-file", type=str, help="Path to JSON file with parameters")
    parser.add_argument("--output", type=str, help="Output file path (default: stdout)")
    parser.add_argument("--count", type=int, default=1, help="Number of intents to generate")
    parser.add_argument("--interval", type=float, default=0, help="Interval between generations (seconds)")
    
    args = parser.parse_args()
    
    try:
        # Load parameters
        params = load_parameters(args.params, args.params_file, args.type)
        
        # Create generator
        generator = IntentGenerator()
        
        # Generate intent(s)
        if args.count > 1:
            intents = generator.generate_sequence(args.type, params, args.count, args.interval)
            output = "\n\n".join(intents)
        else:
            output = generator.generate(args.type, params)
        
        # Output result
        if args.output:
            with open(args.output, 'w') as f:
                f.write(output)
            print(f"Intent(s) written to {args.output}")
        else:
            print(output)
            
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def load_parameters(params_str: str = None, params_file: str = None, intent_type: str = None) -> Dict[str, Any]:
    """Load parameters from string or file."""
    if params_str:
        return json.loads(params_str)
    elif params_file:
        with open(params_file, 'r') as f:
            return json.load(f)
    else:
        # Return default parameters based on type
        if intent_type == "network":
            return NetworkIntentParams().__dict__
        elif intent_type == "workload":
            return WorkloadIntentParams().__dict__
        elif intent_type == "combined":
            return CombinedIntentParams().__dict__
        else:
            return {}
