import requests
import json
import re
import uuid
import argparse

# Base URL of the inServ API (will be set dynamically based on port argument)
BASE_URL = None

def test_get_intents():
    url = f"{BASE_URL}/intent"
    print(f"GET {url}")
    response = requests.get(url)
    print("Status Code:", response.status_code)
    print("Response Body:", response.text)
    return response

def test_create_intent(print_turtle_only=False, datacenter="EC21"):
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
                f"    data5g:DataCenter \"{datacenter}\" ;\n"
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

def test_create_hello_intent(print_turtle_only=False, datacenter="EC21"):
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
                f"    data5g:DataCenter \"{datacenter}\" ;\n"
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

def test_create_rusty_llm_intent(print_turtle_only=False, datacenter="EC21"):
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
                f"    data5g:DataCenter \"{datacenter}\" ;\n"
                "    data5g:DeploymentDescriptor \"http://start5g-1.cs.uit.no:3040/charts/rusty-llm-0.1.16.tgz\" .\n\n"
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
        print("\nChecking if intent was created despite the connection error...")
        # Try to find the intent that might have been created
        try:
            get_response = requests.get(url, timeout=10)
            if get_response.status_code == 200:
                intents = get_response.json()
                if isinstance(intents, list) and len(intents) > 0:
                    # Look for the most recent intent matching our name
                    matching_intents = [i for i in intents if i.get("name") == payload["name"]]
                    if matching_intents:
                        latest_intent = matching_intents[-1]  # Get the most recent one
                        print(f"\nNote: Intent appears to have been created with ID: {latest_intent.get('id')}")
                        return json.dumps(latest_intent)
        except Exception as check_error:
            print(f"Could not verify intent creation: {check_error}")
        return None
    except requests.exceptions.Timeout:
        print("Request timed out after 30 seconds")
        return None
    except requests.exceptions.RequestException as e:
        error_str = str(e)
        print(f"Request Error: {e}")
        # Check if this is an IncompleteRead error
        if "IncompleteRead" in error_str or "Connection broken" in error_str:
            print("\nConnection was broken during response. Checking if intent was created...")
            # Try to find the intent that might have been created
            try:
                get_response = requests.get(url, timeout=10)
                if get_response.status_code == 200:
                    intents = get_response.json()
                    if isinstance(intents, list) and len(intents) > 0:
                        # Look for the most recent intent matching our name
                        matching_intents = [i for i in intents if i.get("name") == payload["name"]]
                        if matching_intents:
                            latest_intent = matching_intents[-1]  # Get the most recent one
                            print(f"\nNote: Intent appears to have been created with ID: {latest_intent.get('id')}")
                            return json.dumps(latest_intent)
            except Exception as check_error:
                print(f"Could not verify intent creation: {check_error}")
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

def test_create_combined_intent(print_turtle_only=False, datacenter="EC21"):
    url = f"{BASE_URL}/intent"
    
    # Generate UUIDs for each identifier type
    intent_uuid = uuid.uuid4().hex
    de_uuid = uuid.uuid4().hex
    co_deploy_uuid = uuid.uuid4().hex
    cx_deploy_uuid = uuid.uuid4().hex
    ne_uuid = uuid.uuid4().hex
    co_bandwidth_uuid = uuid.uuid4().hex
    co_latency_uuid = uuid.uuid4().hex
    cx_network_uuid = uuid.uuid4().hex
    rg_uuid = uuid.uuid4().hex
    re_uuid = uuid.uuid4().hex
    
    # Create identifiers with prefixes
    intent_id = f"I{intent_uuid}"
    de_id = f"DE{de_uuid}"
    co_deploy_id = f"CO{co_deploy_uuid}"
    cx_deploy_id = f"CX{cx_deploy_uuid}"
    ne_id = f"NE{ne_uuid}"
    co_bandwidth_id = f"CO{co_bandwidth_uuid}"
    co_latency_id = f"CO{co_latency_uuid}"
    cx_network_id = f"CX{cx_network_uuid}"
    rg_id = f"RG{rg_uuid}"
    re_id = f"RE{re_uuid}"
    
    # Payload for combined intent (deployment + network slice)
    payload = {
        "@type": "Intent",
        "name": "Combined Intent: Rusty-LLM Deployment and Network Slice",
        "description": "Intent to deploy rusty-llm application to edge datacenter and set up network slice",
        "isBundle": False,
        "priority": "1",
        "context": "5G Network",
        "expression": {
            "@type": "TurtleExpression",
            "iri": "https://example.com/combined-intent-expression",
            "expressionValue": (
                "@prefix data5g: <http://5g4data.eu/5g4data#> .\n"
                "@prefix dct: <http://purl.org/dc/terms/> .\n"
                "@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .\n"
                "@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .\n"
                "@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .\n"
                "@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .\n"
                "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n"
                "@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .\n"
                "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n"
                "@prefix geo: <http://www.opengis.net/ont/geosparql#> .\n\n"
                f"data5g:{intent_id} a icm:Intent,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Deploy rusty-llm application to edge datacenter and set up network slice\" ;\n"
                "    imo:handler \"inOrch\" ;\n"
                "    imo:owner \"inServ\" ;\n"
                f"    log:allOf data5g:{de_id},\n"
                f"        data5g:{ne_id},\n"
                f"        data5g:{re_id} .\n\n"
                f"data5g:{de_id} a data5g:DeploymentExpectation,\n"
                "        icm:Expectation,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Deploy rusty-llm application to Edge Data Center\" ;\n"
                "    icm:target data5g:deployment ;\n"
                f"    log:allOf data5g:{co_deploy_id},\n"
                f"        data5g:{cx_deploy_id} .\n\n"
                f"data5g:{co_deploy_id} a icm:Condition ;\n"
                "    dct:description \"Token compute p99 condition quan:smaller: 400ms\" ;\n"
                f"    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target ;\n"
                "            quan:smaller [ quan:unit \"ms\" ;\n"
                "                    rdf:value 400 ] ] .\n\n"
                f"data5g:{cx_deploy_id} a icm:Context,\n"
                "        icm:IntentElement ;\n"
                "    data5g:Application \"rusty-llm\" ;\n"
                f"    data5g:DataCenter \"{datacenter}\" ;\n"
                "    data5g:DeploymentDescriptor \"http://start5g-1.cs.uit.no:3040/charts/rusty-llm-0.1.14.tgz\" .\n\n"
                f"data5g:{ne_id} a data5g:NetworkExpectation,\n"
                "        icm:Expectation,\n"
                "        icm:IntentElement ;\n"
                "    dct:description \"Ensure QoS guarantees for rusty-llm network slice\" ;\n"
                "    icm:target data5g:network-slice ;\n"
                f"    log:allOf data5g:{co_bandwidth_id},\n"
                f"        data5g:{co_latency_id},\n"
                f"        data5g:{cx_network_id} .\n\n"
                f"data5g:{co_bandwidth_id} a icm:Condition ;\n"
                "    dct:description \"Bandwidth condition quan:larger: 300mbit/s\" ;\n"
                f"    set:forAll [ icm:valuesOfTargetProperty data5g:bandwidth_{co_bandwidth_id} ;\n"
                "            quan:larger [ quan:unit \"mbit/s\" ;\n"
                "                    rdf:value 300.0 ] ] .\n\n"
                f"data5g:{co_latency_id} a icm:Condition ;\n"
                "    dct:description \"Latency condition quan:smaller: 50ms\" ;\n"
                f"    set:forAll [ icm:valuesOfTargetProperty data5g:networklatency_{co_latency_id} ;\n"
                "            quan:smaller [ quan:unit \"ms\" ;\n"
                "                    rdf:value 50.0 ] ] .\n\n"
                f"data5g:{cx_network_id} a icm:Context,\n"
                "        icm:IntentElement ;\n"
                "    data5g:appliesToCustomer \"+47 90914547\" ;\n"
                f"    data5g:appliesToRegion data5g:{rg_id} .\n\n"
                f"data5g:{rg_id} a geo:Feature ;\n"
                "    geo:hasGeometry [ a geo:Polygon ;\n"
                "            geo:asWKT \"POLYGON((69.6613 18.9332, 69.6613 18.9782, 69.6163 18.9782, 69.6163 18.9332))\"^^geo:wktLiteral ] .\n\n"
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
        print("\nChecking if intent was created despite the connection error...")
        # Try to find the intent that might have been created
        try:
            get_response = requests.get(url, timeout=10)
            if get_response.status_code == 200:
                intents = get_response.json()
                if isinstance(intents, list) and len(intents) > 0:
                    # Look for the most recent intent matching our name
                    matching_intents = [i for i in intents if i.get("name") == payload["name"]]
                    if matching_intents:
                        latest_intent = matching_intents[-1]  # Get the most recent one
                        print(f"\nNote: Intent appears to have been created with ID: {latest_intent.get('id')}")
                        return json.dumps(latest_intent)
        except Exception as check_error:
            print(f"Could not verify intent creation: {check_error}")
        return None
    except requests.exceptions.Timeout:
        print("Request timed out after 30 seconds")
        return None
    except requests.exceptions.RequestException as e:
        error_str = str(e)
        print(f"Request Error: {e}")
        # Check if this is an IncompleteRead error
        if "IncompleteRead" in error_str or "Connection broken" in error_str:
            print("\nConnection was broken during response. Checking if intent was created...")
            # Try to find the intent that might have been created
            try:
                get_response = requests.get(url, timeout=10)
                if get_response.status_code == 200:
                    intents = get_response.json()
                    if isinstance(intents, list) and len(intents) > 0:
                        # Look for the most recent intent matching our name
                        matching_intents = [i for i in intents if i.get("name") == payload["name"]]
                        if matching_intents:
                            latest_intent = matching_intents[-1]  # Get the most recent one
                            print(f"\nNote: Intent appears to have been created with ID: {latest_intent.get('id')}")
                            return json.dumps(latest_intent)
            except Exception as check_error:
                print(f"Could not verify intent creation: {check_error}")
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
    global BASE_URL
    parser = argparse.ArgumentParser(description="Create intents using TM Forum API")
    parser.add_argument("-turtle", action="store_true", 
                       help="Only print the resulting turtle expression without sending the request")
    parser.add_argument("--datacenter", type=str, default="EC21",
                       help="Set the datacenter for the intent (default: EC21)")
    parser.add_argument("--port", type=int, default=3021,
                       help="Port to use in the BASE_URL (default: 3021)")
    args = parser.parse_args()
    
    # Construct BASE_URL with the specified port
    BASE_URL = f"http://start5g-1.cs.uit.no:{args.port}/tmf-api/intentManagement/v5"
   
    # print("\nTesting POST /intent")
    # result = test_create_intent(print_turtle_only=args.turtle, datacenter=args.datacenter)
    
    # print("\nTesting POST /intent (Rusty-llm Application)")
    # rusty_result = test_create_rusty_llm_intent(print_turtle_only=args.turtle, datacenter=args.datacenter)
    
    # # If -turtle flag was used, the functions already printed the turtle and returned None
    # if args.turtle:
    #     return
    
    # if rusty_result:
    #     try:
    #         created_rusty_intent = json.loads(rusty_result)
    #         if created_rusty_intent and "id" in created_rusty_intent:
    #             rusty_intent_id = created_rusty_intent["id"]
    #             print(f"Created Rusty-llm Intent with id: {rusty_intent_id}")
    #         else:
    #             print("Response received but no intent ID found")
    #     except (json.JSONDecodeError, TypeError):
    #         print("Failed to parse response as JSON")
    # else:
    #     print("Failed to create Rusty-llm Intent - check the error message above")
    print("\nTesting POST /intent (Combined Intent: Rusty-LLM Deployment and Network Slice)")
    combined_result = test_create_combined_intent(print_turtle_only=args.turtle, datacenter=args.datacenter)
    
    # If -turtle flag was used, the functions already printed the turtle and returned None
    if args.turtle:
        return
    
    if combined_result:
        try:
            created_combined_intent = json.loads(combined_result)
            if created_combined_intent and "id" in created_combined_intent:
                combined_intent_id = created_combined_intent["id"]
                print(f"Created Combined Intent with id: {combined_intent_id}")
            else:
                print("Response received but no intent ID found")
        except (json.JSONDecodeError, TypeError):
            print("Failed to parse response as JSON")
    else:
        print("Failed to create Combined Intent - check the error message above")
    
    
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
