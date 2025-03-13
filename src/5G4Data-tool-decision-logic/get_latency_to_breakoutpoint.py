import pandas as pd
import random
import chardet

# File path to the CSV file
file_path = "../../../INTEND-synthetic-data/generated-syntetic-data/Nordic_Latencies_Matrix.csv"

# Detect encoding
with open(file_path, "rb") as f:
    result = chardet.detect(f.read())  # Detect file encoding
    encoding_type = result["encoding"]
    print(f"Detected file encoding: {encoding_type}")

try:
    # Load the CSV with detected encoding
    latency_df = pd.read_csv(file_path, index_col=0, encoding=encoding_type)
except FileNotFoundError:
    print(f"Error: File '{file_path}' not found.")
    exit()
except UnicodeDecodeError:
    print("Error: Could not decode the file. Try using a different encoding like 'latin-1' or 'ISO-8859-1'.")
    exit()

def estimate_latency(startpoint, breakout_point):
    """
    Estimate total latency from startpoint → breakout point.
    Includes additional latency from a 5G gNodeB at each hop.
    """
    if startpoint not in latency_df.index:
        return f"Error: Startpoint '{startpoint}' not found in the latency table."
    
    if breakout_point not in latency_df.columns:
        return f"Error: Breakout point '{breakout_point}' not found in the latency table."

    try:
        base_latency = latency_df.loc[startpoint, breakout_point]
        additional_latency = random.randint(4, 12)  # Simulate 5G gNodeB latency
        estimated_latency = base_latency + additional_latency
        return f"Estimated latency from gNodeB close to {startpoint} to {breakout_point}: {estimated_latency:.1f} ms"
    except KeyError:
        return f"Error: Could not find latency data for '{startpoint}' to '{breakout_point}' breakoutpoint."

# Example usage
startpoint = input("Enter the startpoint city: ").strip()
breakout_point = input("Enter the breakout point city: ").strip()

print(estimate_latency(startpoint, breakout_point))
