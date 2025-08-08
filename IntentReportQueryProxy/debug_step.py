#!/usr/bin/env python3
"""
Debug script to test step parameter handling
"""

def test_step_parameter_logic():
    """Test the step parameter logic"""
    
    # Test cases
    test_cases = [
        None,
        '',
        '5s',
        '60s',
        '  30s  ',
        '1m',
        '1h'
    ]
    
    print("Testing step parameter logic:")
    print("=" * 40)
    
    for step in test_cases:
        print(f"\nTesting step: '{step}'")
        
        # Apply the same logic as in the app
        step_param = step if step else '60s'
        print(f"  step_param = step if step else '60s': '{step_param}'")
        
        if step_param and step_param.strip() and step_param.strip() != '':
            print(f"  ✓ Valid step parameter: '{step_param}'")
        else:
            print(f"  ✗ Invalid step parameter: '{step_param}'")
            print(f"  Using default: '60s'")

if __name__ == "__main__":
    test_step_parameter_logic() 