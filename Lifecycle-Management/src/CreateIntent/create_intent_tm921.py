import requests
import json
import re
import uuid
import argparse

# Base URL of the API
BASE_URL = "http://start5g-1.cs.uit.no:3021/tmf-api/intentManagement/v5"

def test_get_intents():
    url = f"{BASE_URL}/intent"
    print(f"GET {url}")
    response = requests.get(url)
    print("Status Code:", response.status_code)
    print("Response Body:", response.text)
    return response

def test_create_intent(print_turtle_only=False):
    url = f"{BASE_URL}/intent"
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
            )  # Python automatically concatenates adjacent string literals
        }
    }
    
    # If -turtle flag is set, only print the turtle expression and return
    if print_turtle_only:
        print(payload["expression"]["expressionValue"])
        return None
    
    print(f"POST {url}")
    headers = {"Content-Type": "application/json"}
    params = {
        "fields": "id,name,expression"  # Adjust as needed.
    }
    try:
        response = requests.post(url, headers=headers, params=params, json=payload, timeout=30)
        print("Status Code:", response.status_code)
        print("Response Body:", response.text)
    except requests.exceptions.ConnectionError as e:
        print(f"Connection Error: {e}")
        print("The server closed the connection. This might indicate:")
        print("  - The server crashed while processing the request")
        print("  - The payload is too large or malformed")
        print("  - Network connectivity issues")
        return None
    except requests.exceptions.Timeout:
        print("Request timed out after 30 seconds")
        return None
    except requests.exceptions.RequestException as e:
        print(f"Request Error: {e}")
        return None
    if response.status_code in [200, 201]:
        try:
            return json.dumps(response.json())  # Return as JSON string for consistency
        except json.JSONDecodeError:
            return response.text
    elif response.status_code == 500:
        # Try to extract intent ID from error message if intent was created
        try:
            error_data = response.json()
            if "detail" in error_data:
                # Look for intent ID in the error detail
                id_match = re.search(r"'id':\s*'([^']+)'", error_data["detail"])
                if id_match:
                    intent_id = id_match.group(1)
                    print(f"\nNote: Intent may have been created with ID: {intent_id}")
                    print("Attempting to retrieve the intent...")
                    # Try to get the intent
                    get_response = requests.get(f"{BASE_URL}/intent/{intent_id}")
                    print(f"GET Status Code: {get_response.status_code}")
                    if get_response.status_code == 200:
                        return json.dumps(get_response.json())
                    else:
                        print(f"GET Response: {get_response.text}")
        except (json.JSONDecodeError, KeyError, AttributeError):
            pass
    return None

def test_create_hello_intent(print_turtle_only=False):
    url = f"{BASE_URL}/intent"
    
    # Generate UUIDs for each identifier type
    intent_uuid = uuid.uuid4().hex
    de_uuid = uuid.uuid4().hex
    co_uuid = uuid.uuid4().hex
    cx_uuid = uuid.uuid4().hex
    re_uuid = uuid.uuid4().hex
    
    # Create identifiers with prefixes
    intent_id = f"I{intent_uuid}"
    de_id = f"DE{de_uuid}"
    co_id = f"CO{co_uuid}"
    cx_id = f"CX{cx_uuid}"
    re_id = f"RE{re_uuid}"
    
    # Payload for hello application intent
    payload = {
        "@type": "Intent",
        "name": "Hello Application Deployment Intent",
        "description": "Intent to deploy hello Flask application to edge datacenter",
        "isBundle": False,
        "priority": "1",
        "context": "5G Network",
        "expression": {
            "@type": "TurtleExpression",
            "iri": "https://example.com/hello-intent-expression",
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
                f"data5g:{intent_id} a icm:Intent,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Deploy hello Flask application to edge datacenter\" ;\n"
                "    imo:handler \"inOrch\" ;\n"
                "    imo:owner \"inServ\" ;\n"
                f"    log:allOf data5g:{de_id},\n"
                f"        data5g:{re_id} .\n\n"
                f"data5g:{co_id} a icm:Condition ;\n"
                "    dct:description \"Compute latency condition quan:smaller: 1000ms\" ;\n"
                f"    set:forAll [ icm:valuesOfTargetProperty data5g:computelatency_{co_id} ;\n"
                "            quan:smaller [ quan:unit \"ms\" ;\n"
                "                    rdf:value 1000.0 ] ] .\n\n"
                f"data5g:{cx_id} a icm:Context,\n"
                "        icm:IntentElement ;\n"
                "    data5g:Application \"hello\" ;\n"
                "    data5g:DataCenter \"EC21\" ;\n"
                "    data5g:DeploymentDescriptor \"http://start5g-1.cs.uit.no:3040/charts/hello-0.1.0.tgz\" .\n\n"
                f"data5g:{de_id} a data5g:DeploymentExpectation,\n"
                "        icm:Expectation,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Deploy hello application to Edge Data Center\" ;\n"
                "    icm:target data5g:deployment ;\n"
                f"    log:allOf data5g:{co_id},\n"
                f"        data5g:{cx_id} .\n\n"
                f"data5g:{re_id} a icm:Expectation,\n"
                "        icm:IntentElement,\n"
                "        icm:ReportingExpectation ;\n"
                "    dct:description \"Report if expectation is met with reports including metrics related to expectations.\" ;\n"
                "    icm:target data5g:deployment .\n"
            )
        }
    }
    
    # If -turtle flag is set, only print the turtle expression and return
    if print_turtle_only:
        print(payload["expression"]["expressionValue"])
        return None
    
    print(f"POST {url}")
    headers = {"Content-Type": "application/json"}
    params = {
        "fields": "id,name,expression"  # Adjust as needed.
    }
    try:
        response = requests.post(url, headers=headers, params=params, json=payload, timeout=30)
        print("Status Code:", response.status_code)
        print("Response Body:", response.text)
    except requests.exceptions.ConnectionError as e:
        print(f"Connection Error: {e}")
        print("The server closed the connection. This might indicate:")
        print("  - The server crashed while processing the request")
        print("  - The payload is too large or malformed")
        print("  - Network connectivity issues")
        return None
    except requests.exceptions.Timeout:
        print("Request timed out after 30 seconds")
        return None
    except requests.exceptions.RequestException as e:
        print(f"Request Error: {e}")
        return None
    if response.status_code in [200, 201]:
        try:
            return json.dumps(response.json())  # Return as JSON string for consistency
        except json.JSONDecodeError:
            return response.text
    elif response.status_code == 500:
        # Try to extract intent ID from error message if intent was created
        try:
            error_data = response.json()
            if "detail" in error_data:
                # Look for intent ID in the error detail
                id_match = re.search(r"'id':\s*'([^']+)'", error_data["detail"])
                if id_match:
                    intent_id = id_match.group(1)
                    print(f"\nNote: Intent may have been created with ID: {intent_id}")
                    print("Attempting to retrieve the intent...")
                    # Try to get the intent
                    get_response = requests.get(f"{BASE_URL}/intent/{intent_id}")
                    print(f"GET Status Code: {get_response.status_code}")
                    if get_response.status_code == 200:
                        return json.dumps(get_response.json())
                    else:
                        print(f"GET Response: {get_response.text}")
        except (json.JSONDecodeError, KeyError, AttributeError):
            pass
    return None

def test_create_rusty_llm_intent(print_turtle_only=False):
    url = f"{BASE_URL}/intent"
    
    # Generate UUIDs for each identifier type
    intent_uuid = uuid.uuid4().hex
    de_uuid = uuid.uuid4().hex
    co_uuid = uuid.uuid4().hex
    cx_uuid = uuid.uuid4().hex
    re_uuid = uuid.uuid4().hex
    
    # Create identifiers with prefixes
    intent_id = f"I{intent_uuid}"
    de_id = f"DE{de_uuid}"
    co_id = f"CO{co_uuid}"
    cx_id = f"CX{cx_uuid}"
    re_id = f"RE{re_uuid}"
    
    # Payload for rusty-llm application intent
    payload = {
        "@type": "Intent",
        "name": "Rusty-LLM Application Deployment Intent",
        "description": "Intent to deploy rusty-llm with openwebui application to edge datacenter",
        "isBundle": False,
        "priority": "1",
        "context": "5G Network",
        "expression": {
            "@type": "TurtleExpression",
            "iri": "https://example.com/rusty-llm-intent-expression",
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
                f"data5g:{intent_id} a icm:Intent,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Deploy rusty-llm application to edge datacenter\" ;\n"
                "    imo:handler \"inOrch\" ;\n"
                "    imo:owner \"inServ\" ;\n"
                f"    log:allOf data5g:{de_id},\n"
                f"        data5g:{re_id} .\n\n"
                f"data5g:{co_id} a icm:Condition ;\n"
                "    dct:description \"Token compute p99 condition quan:smaller: 400ms\" ;\n"
                f"    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target ;\n"
                "            quan:smaller [ quan:unit \"ms\" ;\n"
                "                    rdf:value 400 ] ] .\n\n"
                f"data5g:{cx_id} a icm:Context,\n"
                "        icm:IntentElement ;\n"
                "    data5g:Application \"rusty-llm\" ;\n"
                "    data5g:DataCenter \"EC21\" ;\n"
                "    data5g:DeploymentDescriptor \"http://start5g-1.cs.uit.no:3040/charts/rusty-llm-0.1.12.tgz\" .\n\n"
                f"data5g:{de_id} a data5g:DeploymentExpectation,\n"
                "        icm:Expectation,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Deploy rusty-llm application to Edge Data Center\" ;\n"
                "    icm:target data5g:deployment ;\n"
                f"    log:allOf data5g:{co_id},\n"
                f"        data5g:{cx_id} .\n\n"
                f"data5g:{re_id} a icm:Expectation,\n"
                "        icm:IntentElement,\n"
                "        icm:ReportingExpectation ;\n"
                "    dct:description \"Report if expectation is met with reports including metrics related to expectations.\" ;\n"
                "    icm:target data5g:deployment .\n"
            )
        }
    }
    
    # If -turtle flag is set, only print the turtle expression and return
    if print_turtle_only:
        print(payload["expression"]["expressionValue"])
        return None
    
    print(f"POST {url}")
    headers = {"Content-Type": "application/json"}
    params = {
        "fields": "id,name,expression"  # Adjust as needed.
    }
    try:
        response = requests.post(url, headers=headers, params=params, json=payload, timeout=30)
        print("Status Code:", response.status_code)
        print("Response Body:", response.text)
    except requests.exceptions.ConnectionError as e:
        print(f"Connection Error: {e}")
        print("The server closed the connection. This might indicate:")
        print("  - The server crashed while processing the request")
        print("  - The payload is too large or malformed")
        print("  - Network connectivity issues")
        return None
    except requests.exceptions.Timeout:
        print("Request timed out after 30 seconds")
        return None
    except requests.exceptions.RequestException as e:
        print(f"Request Error: {e}")
        return None
    if response.status_code in [200, 201]:
        try:
            return json.dumps(response.json())  # Return as JSON string for consistency
        except json.JSONDecodeError:
            return response.text
    elif response.status_code == 500:
        # Try to extract intent ID from error message if intent was created
        try:
            error_data = response.json()
            if "detail" in error_data:
                # Look for intent ID in the error detail
                id_match = re.search(r"'id':\s*'([^']+)'", error_data["detail"])
                if id_match:
                    intent_id = id_match.group(1)
                    print(f"\nNote: Intent may have been created with ID: {intent_id}")
                    print("Attempting to retrieve the intent...")
                    # Try to get the intent
                    get_response = requests.get(f"{BASE_URL}/intent/{intent_id}")
                    print(f"GET Status Code: {get_response.status_code}")
                    if get_response.status_code == 200:
                        return json.dumps(get_response.json())
                    else:
                        print(f"GET Response: {get_response.text}")
        except (json.JSONDecodeError, KeyError, AttributeError):
            pass
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
    parser = argparse.ArgumentParser(description="Create intents using TM Forum API")
    parser.add_argument("-turtle", action="store_true", 
                       help="Only print the resulting turtle expression without sending the request")
    args = parser.parse_args()
   
    # print("\nTesting POST /intent")
    # result = test_create_intent(print_turtle_only=args.turtle)
    
    print("\nTesting POST /intent (Rusty-llm Application)")
    rusty_result = test_create_rusty_llm_intent(print_turtle_only=args.turtle)
    
    # If -turtle flag was used, the functions already printed the turtle and returned None
    if args.turtle:
        return
    
    if rusty_result:
        try:
            created_rusty_intent = json.loads(rusty_result)
            if created_rusty_intent and "id" in created_rusty_intent:
                rusty_intent_id = created_rusty_intent["id"]
                print(f"Created Rusty-llm Intent with id: {rusty_intent_id}")
            else:
                print("Response received but no intent ID found")
        except (json.JSONDecodeError, TypeError):
            print("Failed to parse response as JSON")
    else:
        print("Failed to create Rusty-llm Intent - check the error message above")
    
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
