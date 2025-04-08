from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
import os
import sys
from datetime import datetime
import uuid
import json
from dotenv import load_dotenv
import requests

# Add parent directory to Python path to find shared module
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from shared.graphdb_client import GraphDBClient

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Initialize two GraphDB clients - one for intents and one for reports
graphdb_url = os.getenv('GRAPHDB_URL', 'http://start5g-1:7200')
if not graphdb_url.startswith('http://'):
    graphdb_url = f'http://{graphdb_url}'

print(f"Connecting to GraphDB at {graphdb_url}")
print(f"Using repository 'intents' for intents")
print(f"Using repository 'intent-reports' for reports")

intents_client = GraphDBClient(graphdb_url, repository='intents')
reports_client = GraphDBClient(graphdb_url, repository='intent-reports')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/query-intents')
def query_intents():
    """Query all intents with their details"""
    try:
        query = """
        PREFIX data5g: <http://5g4data.eu/5g4data#>
        PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
        PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
        
        SELECT DISTINCT ?intent ?id ?type
        WHERE {
            ?intent a icm:Intent ;
                log:allOf ?de .
            ?de icm:target ?target .
            BIND(REPLACE(STR(?intent), ".*#I", "") AS ?id)
            BIND(IF(?target = data5g:network-slice, "Network",
                    IF(?target = data5g:deployment, "Workload",
                    IF(?target = data5g:network-slice && EXISTS { ?intent log:allOf data5g:RE2 }, "Combined", "Unknown"))) AS ?type)
            FILTER(STRSTARTS(STR(?de), "http://5g4data.eu/5g4data#DE"))
        }
        ORDER BY ?id
        """
        
        results = intents_client.query_intents(query)
        
        intents = []
        for binding in results['results']['bindings']:
            intent = {
                'id': binding['id']['value'],
                'type': binding['type']['value']
            }
            intents.append(intent)
        
        return jsonify({'intents': intents})
        
    except Exception as e:
        print(f"Error querying intents: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/get-intent/<intent_id>', methods=['GET'])
def get_intent(intent_id):
    try:
        intent_data = intents_client.get_intent(intent_id)
        if not intent_data:
            return jsonify({"error": f"No intent found with ID {intent_id}"}), 404
        return jsonify({
            "intent_id": intent_id,
            "data": intent_data
        })
    except Exception as e:
        print("Error:", str(e))
        return jsonify({"error": str(e)}), 400

@app.route('/api/generate-intent-report', methods=['POST'])
def generate_intent_report():
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['intent_id', 'intent_handling_state', 'report_generated']
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400

        # Create report in Turtle format
        report_id = str(uuid.uuid4())
        report_turtle = f"""
        @prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
        @prefix ir: <http://example.org/intent-reports#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

        ir:{report_id} a icm:IntentReport ;
            icm:about <http://5g4data.eu/5g4data#I{data['intent_id']}> ;
            icm:reportNumber "{data.get('report_number', '1')}"^^xsd:integer ;
            icm:reportGenerated "{data['report_generated']}"^^xsd:dateTime ;
            icm:intentHandlingState "{data['intent_handling_state']}" ;
            icm:intentUpdateState "{data.get('intent_update_state', 'NO_UPDATE_NEEDED')}" ;
            icm:result "{str(data.get('result', 'true')).lower()}"^^xsd:boolean ;
            icm:reason "{data.get('reason', '')}" ;
            icm:targetCount "{data.get('target_count', 0)}"^^xsd:integer .
        """

        # Store the report in the intent-reports repository
        reports_client.store_report(report_turtle)

        return jsonify({
            "message": "Intent report generated successfully",
            "report_id": report_id
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/api/get-last-report/<intent_id>', methods=['GET'])
def get_last_report(intent_id):
    try:
        report_data = reports_client.get_last_report(intent_id)
        
        if not report_data.strip():
            return jsonify({"error": f"No reports found for intent {intent_id}"}), 404
            
        return jsonify({
            "intent_id": intent_id,
            "data": report_data
        })
    except Exception as e:
        print("Error:", str(e))
        return jsonify({"error": str(e)}), 400

@app.route('/api/get-next-report-number/<intent_id>', methods=['GET'])
def get_next_report_number(intent_id):
    try:
        print(f"Fetching next report number for intent: {intent_id}")  # Debug log
        highest_number = reports_client.get_highest_report_number(intent_id)
        next_number = highest_number + 1
        print(f"Current highest number: {highest_number}, next number: {next_number}")  # Debug log
        return jsonify({"next_number": next_number})
    except Exception as e:
        print(f"Error getting next report number: {str(e)}")
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=True, port=port, host='0.0.0.0') 