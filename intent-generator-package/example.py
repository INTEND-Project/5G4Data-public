#!/usr/bin/env python3
"""Example usage of the intent generator package."""

from intent_generator import IntentGenerator, NetworkIntentParams, WorkloadIntentParams, CombinedIntentParams, IntentType


def main():
    """Demonstrate various ways to use the intent generator."""
    
    # Create generator instance
    generator = IntentGenerator()
    
    print("=== Intent Generator Package Examples ===\n")
    
    # Example 1: Network Intent
    print("1. Network Intent Example:")
    print("-" * 30)
    
    network_params = NetworkIntentParams(
        latency=20,
        bandwidth=300,
        location="Oslo, Norway",
        handler="inSwitch",
        owner="inNet",
        description="High-performance network slice for AR application"
    )
    
    network_intent = generator.generate_network_intent(network_params)
    print(f"Generated network intent (first 200 chars):\n{network_intent[:200]}...\n")
    
    # Example 2: Workload Intent
    print("2. Workload Intent Example:")
    print("-" * 30)
    
    workload_params = WorkloadIntentParams(
        compute_latency=15,
        datacenter="EC1",
        application="AR-retail-app",
        handler="inSwitch",
        owner="inNet"
    )
    
    workload_intent = generator.generate_workload_intent(workload_params)
    print(f"Generated workload intent (first 200 chars):\n{workload_intent[:200]}...\n")
    
    # Example 3: Combined Intent
    print("3. Combined Intent Example:")
    print("-" * 30)
    
    combined_params = CombinedIntentParams(
        latency=20,
        bandwidth=300,
        compute_latency=15,
        location="Stockholm, Sweden",
        datacenter="EC2",
        application="VR-gaming-app",
        handler="inSwitch",
        owner="inNet"
    )
    
    combined_intent = generator.generate_combined_intent(combined_params)
    print(f"Generated combined intent (first 200 chars):\n{combined_intent[:200]}...\n")
    
    # Example 4: Using generic generate method
    print("4. Generic Generate Method Example:")
    print("-" * 30)
    
    # Using enum
    intent1 = generator.generate(IntentType.NETWORK, network_params)
    print(f"Generated with enum (first 100 chars):\n{intent1[:100]}...\n")
    
    # Using string
    intent2 = generator.generate("workload", workload_params)
    print(f"Generated with string (first 100 chars):\n{intent2[:100]}...\n")
    
    # Using dictionary
    intent3 = generator.generate("network", {
        "latency": 25,
        "bandwidth": 500,
        "location": "Copenhagen, Denmark"
    })
    print(f"Generated with dict (first 100 chars):\n{intent3[:100]}...\n")
    
    # Example 5: Range conditions
    print("5. Range Conditions Example:")
    print("-" * 30)
    
    range_params = NetworkIntentParams(
        latency=10,
        latency_operator="inRange",
        latency_end=30,
        bandwidth=200,
        bandwidth_operator="inRange",
        bandwidth_end=500,
        location="Berlin, Germany"
    )
    
    range_intent = generator.generate_network_intent(range_params)
    print(f"Generated range intent (first 200 chars):\n{range_intent[:200]}...\n")
    
    # Example 6: Sequence generation
    print("6. Sequence Generation Example:")
    print("-" * 30)
    
    sequence_params = NetworkIntentParams(
        latency=20,
        bandwidth=300,
        handler="inSwitch",
        owner="inNet"
    )
    
    intents = generator.generate_sequence("network", sequence_params, count=3, interval=0.1)
    print(f"Generated {len(intents)} intents in sequence")
    print(f"First intent (first 100 chars):\n{intents[0][:100]}...\n")
    
    print("=== Examples Complete ===")


if __name__ == "__main__":
    main()
