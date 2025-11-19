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
                "@prefix data5g: <http://5g4data.eu/5g4data#> .\n"
                "@prefix dct: <http://purl.org/dc/terms/> .\n"
                "@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .\n"
                "@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .\n"
                "@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .\n"
                "@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .\n"
                "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n"
                "@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .\n"
                "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n"
                "data5g:I3ad0057e78fd4445a12632770206fc0c a icm:Intent,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Deploy AI inference service to edge datacenter\" ;\n"
                "    imo:handler \"inOrch\" ;\n"
                "    imo:owner \"inSwitch\" ;\n"
                "    log:allOf data5g:DE41c5d73d719e43f2b11857ddb91d4c6f,\n"
                "        data5g:RE2e36ba07cb63430a9bba2513e6c396d5 .\n\n"
                "data5g:COb727e5ead6474c6992daf8180c4e464f a icm:Condition ;\n"
                "    dct:description \"Compute latency condition quan:smaller: 1000ms\" ;\n"
                "    set:forAll [ icm:valuesOfTargetProperty data5g:computelatency_COb727e5ead6474c6992daf8180c4e464f ;\n"
                "            quan:smaller [ quan:unit \"ms\" ;\n"
                "                    rdf:value 1000.0 ] ] .\n\n"
                "data5g:CXaeb2dd7d12bc44dfb6506094bd5644c3 a icm:Context,\n"
                "        icm:IntentElement ;\n"
                "    data5g:Application \"ai-inference-service\" ;\n"
                "    data5g:DataCenter \"EC21\" ;\n"
                "    data5g:DeploymentDescriptor \"http://intend.eu/5G4DataWorkloadCatalogue/ai-inference-deployment.yaml\" .\n\n"
                "data5g:DE41c5d73d719e43f2b11857ddb91d4c6f a data5g:DeploymentExpectation,\n"
                "        icm:Expectation,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Deploy application to Edge Data Center\" ;\n"
                "    icm:target data5g:deployment ;\n"
                "    log:allOf data5g:COb727e5ead6474c6992daf8180c4e464f,\n"
                "        data5g:CXaeb2dd7d12bc44dfb6506094bd5644c3 .\n\n"
                "data5g:RE2e36ba07cb63430a9bba2513e6c396d5 a icm:Expectation,\n"
                "        icm:IntentElement,\n"
                "        icm:ReportingExpectation ;\n"
                "    dct:description \"Report if expectation is met with reports including metrics related to expectations.\" ;\n"
                "    icm:target data5g:deployment .\n"
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
