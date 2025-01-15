from SPARQLWrapper import SPARQLWrapper, JSON
import pandas as pd

# SPARQL endpoint and query
sparql_endpoint = "http://Arnes-MacBook-Pro.local:7200/repositories/Slice1LatencyMeasurements"  # Replace with your SPARQL endpoint
query = """
PREFIX ex: <http://example.com/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX prov: <http://www.w3.org/ns/prov#>
SELECT ?measurement ?value ?unit ?timestamp
WHERE {
    ex:Slice1 ex:hasLatencyMeasurement ?measurement .
    ?measurement rdf:type ex:LatencyMeasurement ;
                 prov:generatedAtTime ?timestamp ;
                 rdf:value ?value ;
                 quan:unit ?unit .
}
"""

# Function to execute SPARQL query and convert results to DataFrame
def execute_sparql_query(endpoint, query):
    sparql = SPARQLWrapper(endpoint)
    sparql.setQuery(query)
    sparql.setReturnFormat(JSON)
    results = sparql.query().convert()

    # Parse the SPARQL results into a DataFrame
    data = []
    for result in results["results"]["bindings"]:
        data.append({
            "measurement": result["measurement"]["value"],
            "value": float(result["value"]["value"]),
            "unit": result["unit"]["value"],
            "timestamp": result["timestamp"]["value"]
        })
    return pd.DataFrame(data)

# Execute the query
df = execute_sparql_query(sparql_endpoint, query)
print(df['value'])
# Parameters for evaluation
threshold_value = 10.0  # Threshold limit in ms
percentage_limit = 20.0  # Percentage limit

# Analyze the data
above_threshold_count = df[df['value'] > threshold_value].shape[0]
total_measurements = df.shape[0]
percentage_above_threshold = (above_threshold_count / total_measurements) * 100

# Output the results
if percentage_above_threshold > percentage_limit:
    print(f"More than {percentage_limit}% of the measurements ({percentage_above_threshold:.2f}%) are above the threshold of {threshold_value} ms.")
else:
    print(f"Only {percentage_above_threshold:.2f}% of the measurements are above the threshold of {threshold_value} ms.")
