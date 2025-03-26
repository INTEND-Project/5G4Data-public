import requests
import json

# Base URL of the API
BASE_URL = "http://localhost:8080/intentManagement"

def test_get_intents():
    url = f"{BASE_URL}/intent"
    print(f"GET {url}")
    response = requests.get(url)
    print("Status Code:", response.status_code)
    print("Response Body:", response.text)
    return response

def test_create_intent():
    url = f"{BASE_URL}/intent"
    print(f"POST {url}")
    # Sample payload conforming to the minimal Intent_FVO schema
    payload = {
        "@type": "Intent",
        "name": "Sample Intent for 5G Network Slice",
        "description": "Intent to ensure low latency and sufficient bandwidth",
        "isBundle": False,
        "priority": "1",
        "context": "5G Network",
        "expression": {
            "@type": "TurtleExpression",
            "iri": "https://example.com/intent-expression",
            "expressionValue": (
                "@prefix dct:  <http://purl.org/dc/terms/> .\n"
                "@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .\n"
                "@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n"
                "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n"
                "@prefix log:  <http://www.w3.org/2000/10/swap/log#> .\n"
                "@prefix set:  <http://www.w3.org/2000/10/swap/set#> .\n"
                "@prefix quan: <http://www.w3.org/2000/10/swap/quantities#> .\n"
                "@prefix geo:  <http://www.opengis.net/ont/geosparql#> .\n"
                "@prefix 5g4data: <http://5g4data.eu/> .\n\n"
                "5g4data:I1 a icm:Intent ;\n"
                "  log:allOf ( 5g4data:DE1 5g4data:RE1 ) ;\n"
                ".\n\n"
                "5g4data:DE1 a icm:DeliveryExpectation ;\n"
                "  icm:target 5g4data:network-slice ;\n"
                "  dct:description \"Ensure low latency and sufficient bandwidth in the 5G network for customer +47 90914547 store in Tromsø.\"@en ;\n"
                "  log:allOf ( 5g4data:C1 5g4data:C2 5g4data:CX1 ) ;\n"
                ".\n\n"
                "5g4data:C1 a icm:Condition ;\n"
                "  set:forAll (\n"
                "    _:X\n"
                "    [ icm:valuesOfTargetProperty ( 5g4data:5GTelenorLatency ) ]\n"
                "    quan:smaller ( _:X [ rdf:value \"10\"^^xsd:decimal ; quan:unit \"ms\" ] )\n"
                "  ) ;\n"
                ".\n\n"
                "5g4data:C2 a icm:Condition ;\n"
                "  set:forAll (\n"
                "    _:X\n"
                "    [ icm:valuesOfTargetProperty ( 5g4data:5GTelenorBandwidth ) ]\n"
                "    quan:larger ( _:X [ rdf:value \"300\"^^xsd:decimal ; quan:unit \"mbit/s\" ] )\n"
                "  ) ;\n"
                ".\n\n"
                "5g4data:CX1 a icm:Context ;\n"
                "  5g4data:appliesToRegion 5g4data:K1ShoppingMallRegion ;\n"
                ".\n\n"
                "5g4data:K1ShoppingMallRegion a geo:Feature ;\n"
                "  geo:hasGeometry [\n"
                "    a geo:Polygon ;\n"
                "    geo:asWKT \"POLYGON((69.673545 18.921344, 69.673448 18.924026, 69.672195 18.923903, 69.672356 18.921052))\"^^geo:wktLiteral\n"
                "  ] ;\n"
                ".\n\n"
                "5g4data:RE1 a icm:ReportingExpectation ;\n"
                "  icm:target 5g4data:5GNetwork ;\n"
                "  dct:description \"Report if expectation is met with reports including metrics related to expectations.\"@en ;\n"
                "."
            )
        }
    }
    headers = {"Content-Type": "application/json"}
    params = {
        "fields": "id,name,expression"  # Adjust as needed.
    }
    response = requests.post(url, headers=headers, params=params, data=json.dumps(payload))
    print("Status Code:", response.status_code)
    print("Response Body:", response.text)
    if response.status_code in [200, 201]:
        return json.loads(response.text)  # Assuming the created intent is returned as JSON
    else:
        return None

def test_get_intent_by_id(intent_id):
    url = f"{BASE_URL}/intent/{intent_id}"
    print(f"GET {url}")
    response = requests.get(url)
    print("Status Code:", response.status_code)
    print("Response Body:", response.text)
    return response

def test_patch_intent(intent_id):
    url = f"{BASE_URL}/intent/{intent_id}"
    print(f"PATCH {url}")
    # Sample payload for patching (updating description)
    patch_payload = {
        "description": "Updated test intent description"
    }
    headers = {"Content-Type": "application/json"}
    response = requests.patch(url, headers=headers, json=patch_payload)
    print("Status Code:", response.status_code)
    print("Response Body:", response.text)
    return response

def test_delete_intent(intent_id):
    url = f"{BASE_URL}/intent/{intent_id}"
    print(f"DELETE {url}")
    response = requests.delete(url)
    print("Status Code:", response.status_code)
    print("Response Body:", response.text)
    return response

def main():
   
    print("\nTesting POST /intent")
    created_intent = json.loads(test_create_intent())
    if created_intent and "id" in created_intent:
        intent_id = created_intent["id"]
        print(f"Created Intent with id: {intent_id}")
    else:
        print("Failed to create Intent")
        return
    
    # print("Testing GET /intent")
    # test_get_intents()
    
    # print("\nTesting GET /intent/{id}")
    # test_get_intent_by_id(intent_id)
    
    # print("\nTesting PATCH /intent/{id}")
    # test_patch_intent(intent_id)
    
    # print("\nTesting DELETE /intent/{id}")
    # test_delete_intent(intent_id)

if __name__ == "__main__":
    main()
