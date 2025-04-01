import time
import uuid
import random
import argparse
from rdflib import Graph, Namespace, Literal
from rdflib.namespace import RDF, XSD
from datetime import datetime, timedelta
from SPARQLWrapper import SPARQLWrapper, POST

# Define namespaces
EX = Namespace("http://example.com/")
PROV = Namespace("http://www.w3.org/ns/prov#")
QUAN = Namespace("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/")

def generate_random_value():
    # Generate random values between 4 and 17 with a 2% chance of values greater than 9
    if random.random() < 0.02:  # 2% chance
        value = random.uniform(9, 17)  # Random value between 9 and 17
    else:
        value = random.uniform(4, 9)  # Random value between 4 and 9
    return Literal(round(value, 2), datatype=XSD.decimal)

def ensure_slice_root(sparql_endpoint):
    # Create a new graph
    g = Graph()
    slice_uri = EX.Slice1

    # Add Slice1 as the root with a label
    g.add((slice_uri, RDF.type, EX["5G_Slice"]))
    g.add((slice_uri, EX.label, Literal("Slice1")))

    # Serialize the root Slice1 triples into SPARQL format
    triples = ""
    for s, p, o in g:
        triples += f"<{s}> <{p}> {o.n3()} .\n"

    # Construct the SPARQL `INSERT DATA` query
    update_query = f"""
    INSERT DATA {{
        {triples}
    }}
    """

    # Send the query
    sparql = SPARQLWrapper(sparql_endpoint)
    sparql.setMethod(POST)
    sparql.setQuery(update_query)
    sparql.setReturnFormat("json")

    try:
        sparql.query()
        print("Root Slice1 ensured in the repository.")
    except Exception as e:
        print(f"Failed to ensure Slice1 root: {e}")

def add_measurement(sparql_endpoint, timestamp=None):
    # Create a new graph
    g = Graph()

    # Define the resource URIs
    slice_uri = EX.Slice1
    measurement_uri = EX[f"LatencyMeasurement{uuid.uuid4()}"]

    # Generate example data
    value = generate_random_value()
    unit = QUAN["ms"]  # Unit as milliseconds
    timestamp = timestamp or Literal(datetime.utcnow().isoformat(), datatype=XSD.dateTime)

    # Add measurement and link it to Slice1
    g.add((slice_uri, EX.hasLatencyMeasurement, measurement_uri))
    g.add((measurement_uri, RDF.type, EX.LatencyMeasurement))
    g.add((measurement_uri, PROV.generatedAtTime, timestamp))
    g.add((measurement_uri, RDF.value, value))
    g.add((measurement_uri, QUAN.unit, unit))

    # Serialize each triple manually into SPARQL format
    triples = ""
    for s, p, o in g:
        triples += f"<{s}> <{p}> {o.n3()} .\n"

    # Construct the SPARQL `INSERT DATA` query
    update_query = f"""
    INSERT DATA {{
        {triples}
    }}
    """

    # Use SPARQLWrapper to send the SPARQL Update query
    sparql = SPARQLWrapper(sparql_endpoint)
    sparql.setMethod(POST)
    sparql.setQuery(update_query)
    sparql.setReturnFormat("json")

    try:
        sparql.query()
        if not args.numberOfReports:
            print(f"Successfully added measurement: Value={value}, Unit=ms, Timestamp={timestamp}")
    except Exception as e:
        print(f"Failed to add measurement: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add latency measurements to a GraphDB repository.")
    parser.add_argument('-r', '--repository', type=str, required=True, help='The URL of the GraphDB SPARQL endpoint')
    parser.add_argument('-n', '--numberOfReports', type=int, required=False, help='The number of reports to generate')
    parser.add_argument('-t', '--timeBetween', type=int, required=False, default=10, help='Time in seconds between reports (default: 10 seconds)')
    args = parser.parse_args()

    # Combine endpoint and repository to form the full SPARQL endpoint URL
    sparql_endpoint = f"{args.repository}/statements"

    # Ensure the Slice1 root exists in the graph
    ensure_slice_root(sparql_endpoint)

    try:
        if args.numberOfReports:
            # Generate the specified number of reports
            current_time = datetime.utcnow()
            for i in range(args.numberOfReports):
                if args.timeBetween:
                    add = args.timeBetween
                else:
                    add = 10
                timestamp = Literal((current_time + timedelta(seconds=add * i)).isoformat(), datatype=XSD.dateTime)
                add_measurement(sparql_endpoint, timestamp=timestamp)
        else:
            # Generate reports indefinitely every 10 seconds
            while True:
                add_measurement(sparql_endpoint)
                if args.timeBetween:
                    time.sleep(args.timeBetween)
                else:
                    time.sleep(10)
    except KeyboardInterrupt:
        print("Measurement process stopped.")
