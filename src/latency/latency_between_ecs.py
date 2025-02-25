import math
import pandas as pd
import itertools

def haversine(lat1, lon1, lat2, lon2):
    """
    Calculate the great-circle distance between two points 
    on the Earth using the Haversine formula.
    
    Parameters:
    lat1, lon1 -- Latitude and longitude of the first point in decimal degrees
    lat2, lon2 -- Latitude and longitude of the second point in decimal degrees
    
    Returns:
    Distance in kilometers
    """
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    R = 6371.0  # Earth radius in km
    return round(R * c, 2)  # Round to 2 decimal places

def calculate_latency(lat1, lon1, lat2, lon2):
    """
    Calculate network round-trip latency between two cities.

    Steps:
    - Compute one-way distance with Haversine formula
    - Increase distance by 50% (network path is not direct)
    - Convert adjusted distance to latency (6 microseconds per km)
    - Compute **round-trip time (RTT)** (double the one-way latency)
    - Add 30% extra latency for network equipment delays

    Returns:
    Final round-trip latency in milliseconds (rounded to 1 decimal place)
    """
    distance = haversine(lat1, lon1, lat2, lon2)
    adjusted_distance = distance * 1.5  # Increase distance by 50%
    
    # One-way latency
    latency_microseconds = adjusted_distance * 6  
    latency_milliseconds = latency_microseconds / 1000  
    
    # Round-trip latency
    round_trip_latency = latency_milliseconds * 2  
    
    # Add 30% extra latency for network delays
    final_latency = round_trip_latency * 1.3  
    
    return round(final_latency, 1)

def read_city_data(filepath):
    """
    Reads city data from a CSV file.

    Parameters:
    filepath -- Path to the CSV file

    Returns:
    Dictionary with city names as keys and (latitude, longitude) as values
    """
    df = pd.read_csv(filepath)
    return {row["City"]: (row["Latitude"], row["Longitude"]) for _, row in df.iterrows()}

def compute_matrix(cities, metric_function, round_digits=2):
    """
    Computes a matrix of values (distances or latencies) between all cities.

    Parameters:
    cities -- Dictionary with city names as keys and (latitude, longitude) as values
    metric_function -- Function to compute metric (e.g., haversine or latency)
    round_digits -- Number of decimal places for rounding (default: 2)

    Returns:
    Pandas DataFrame with cities as both rows and columns
    """
    city_names = list(cities.keys())
    matrix = pd.DataFrame(index=city_names, columns=city_names)

    for city1, city2 in itertools.combinations(city_names, 2):
        lat1, lon1 = cities[city1]
        lat2, lon2 = cities[city2]
        value = round(metric_function(lat1, lon1, lat2, lon2), round_digits)
        matrix.loc[city1, city2] = value
        matrix.loc[city2, city1] = value  # Ensure symmetry

    matrix.fillna(0, inplace=True)  # Fill diagonal (same city) with 0

    return matrix

# Main execution
if __name__ == "__main__":
    input_file = "../../tmp/cities_lat_lon.csv"
    latency_output_file = "../../generated-syntetic-data/Nordic_Latencies_Matrix.csv"
    distance_output_file = "../../generated-syntetic-data/Nordic_Distances_Matrix.csv"

    cities = read_city_data(input_file)

    # Compute latency and distance matrices
    latency_df = compute_matrix(cities, calculate_latency, round_digits=1)
    distance_df = compute_matrix(cities, haversine, round_digits=2)

    # Save to CSV files
    latency_df.to_csv(latency_output_file, encoding="utf-16")
    distance_df.to_csv(distance_output_file, encoding="utf-16")

    print(f"Latency matrix saved to {latency_output_file}")
    print(f"Distance matrix saved to {distance_output_file}")
