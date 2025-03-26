import argparse
from rdflib import URIRef, Literal
from SPARQLWrapper import SPARQLWrapper, JSON

# Set up argument parser
parser = argparse.ArgumentParser(description='Validate an intent over a set of latency measurements in RDF format.')
parser.add_argument('-r', '--repository', type=str, required=True, help='The URL of the GraphDB repository containing the RDF data.')
args = parser.parse_args()

# Set up SPARQLWrapper and define your query
sparql = SPARQLWrapper(f"{args.repository}")
query = """
PREFIX ex: <http://example.com/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX prov: <http://www.w3.org/ns/prov#>
SELECT ?measurement ?value ?unit ?timestamp
WHERE {{
    ex:Slice1 ex:hasLatencyMeasurement ?measurement .
    ?measurement rdf:type ex:LatencyMeasurement ;
                 prov:generatedAtTime ?timestamp ;
                 rdf:value ?value ;
                 quan:unit ?unit .
}}
"""
sparql.setQuery(query)
sparql.setReturnFormat(JSON)

# Run the query and process the results
results = sparql.query().convert()
intent_valid = True
i=0;j=0
for result in results["results"]["bindings"]:
    i+=1
    value = float(result["value"]["value"])
    unit = str(result["unit"]["value"])
    timestamp = str(result["timestamp"]["value"])  # get the timestamp as a string
    if value >= 10 :  # assuming your Turtle file uses this URI for ms
        j+=1
        intent_valid = False
        print(f"Violating measurement at {timestamp} with value {value} ms")  # print the violating timestamp and value
    else:
        print(f"Measurement at {timestamp} with value {value} ms is OK")  # print the violating timestamp and value
print(f"Checked {i} measurements:")
if intent_valid:
    print(f"All measurements are below 10ms.")
else:
    print(f"There were {j} violations of the intent (measurements above 10ms).")