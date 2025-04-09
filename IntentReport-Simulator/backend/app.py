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

from shared.graphdb_client import IntentReportClient

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app, resources={
    r"/api/*": {
        "origins": ["http://localhost:5001", "http://127.0.0.1:5001"],
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Accept"]
    }
})

# Initialize two GraphDB clients - one for intents and one for reports
graphdb_url = os.getenv('GRAPHDB_URL', 'http://start5g-1:7200')
if not graphdb_url.startswith('http://'):
    graphdb_url = f'http://{graphdb_url}'

print(f"Connecting to GraphDB at {graphdb_url}")
print(f"Using repository 'intents' for intents")
print(f"Using repository 'intent-reports' for reports")

# Initialize clients with explicit repository names
intents_client = IntentReportClient(graphdb_url, repository='intents')
reports_client = IntentReportClient(graphdb_url, repository='intent-reports')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/query-intents')
def query_intents():
    """Query all intents with their details"""
    try:
        results = intents_client.get_intents()
        
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

@app.route('/api/generate-report', methods=['POST'])
def generate_intent_report():
    print("=== Received request to /api/generate-report ===")  # Debug log
    print(f"Request method: {request.method}")  # Debug log
    print(f"Request headers: {dict(request.headers)}")  # Debug log
    print(f"Request data: {request.get_data()}")  # Debug log
    
    try:
        report_data = request.json
        print(f"Received report data: {report_data}")  # Debug log
        
        # Generate Turtle format
        turtle_data = generate_turtle(report_data)
        print(f"Generated Turtle data: {turtle_data}")  # Debug log
        
        # Store in GraphDB using the reports client
        response = reports_client.store_intent_report(turtle_data)
        print(f"GraphDB response: {response}")  # Debug log
        
        return jsonify({"status": "success", "message": "Report generated successfully"})
    except Exception as e:
        print(f"Error generating report: {str(e)}")  # Debug log
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/get-last-intent-report/<intent_id>')
def get_last_intent_report(intent_id):
    try:
        # Get the last report from GraphDB
        turtle_data = reports_client.get_last_intent_report(intent_id)
        if not turtle_data:
            return jsonify({"error": f"No report found for intent {intent_id}"}), 404
        
        return jsonify({"data": turtle_data})
    except Exception as e:
        print(f"Error getting last report: {str(e)}")  # Debug log
        return jsonify({"error": str(e)}), 500

@app.route('/api/get-next-report-number/<intent_id>', methods=['GET'])
def get_next_report_number(intent_id):
    try:
        print(f"Fetching next report number for intent: {intent_id}")  # Debug log
        highest_number = reports_client.get_highest_intent_report_number(intent_id)
        next_number = highest_number + 1
        print(f"Current highest number: {highest_number}, next number: {next_number}")  # Debug log
        return jsonify({"next_number": next_number})
    except Exception as e:
        print(f"Error getting next report number: {str(e)}")
        return jsonify({"error": str(e)}), 400

@app.route('/api/debug/list-reports/<intent_id>')
def list_reports(intent_id):
    try:
        # Query to get all reports for the intent
        query = f"""
        PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
        PREFIX data5g: <http://5g4data.eu/5g4data#>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
        
        SELECT ?report ?number ?timestamp
        WHERE {{
            ?report a icm:IntentReport ;
                    icm:about data5g:I{intent_id} ;
                    icm:reportNumber ?number ;
                    icm:reportGenerated ?timestamp .
        }}
        ORDER BY DESC(?timestamp)
        """
        response = requests.post(
            f"{reports_client.base_url}/repositories/{reports_client.repository}/sparql",
            data={"query": query},
            headers={"Accept": "application/sparql-results+json"}
        )
        response.raise_for_status()
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def generate_turtle(report_data):
    """Generate Turtle format for an intent report"""
    report_id = str(uuid.uuid4())
    
    # Define the full namespaces
    icm_ns = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/"
    data5g_ns = "http://5g4data.eu/5g4data#"
    xsd_ns = "http://www.w3.org/2001/XMLSchema#"
    imo_ns = "http://tio.models.tmforum.org/tio/v3.6.0/IntentModelOntology/"
    
    # Start with the base statement
    turtle = f'<{icm_ns}RP{report_id}> a <{icm_ns}IntentReport> ;'
    turtle += f' <{icm_ns}about> <{data5g_ns}I{report_data["intent_id"]}> ;'
    turtle += f' <{icm_ns}reportNumber> "{report_data["report_number"]}"^^<{xsd_ns}integer> ;'
    turtle += f' <{icm_ns}reportGenerated> "{report_data["report_generated"]}"^^<{xsd_ns}dateTime>'

    # Add state based on report type
    if 'intent_handling_state' in report_data:
        turtle += f' ; <{icm_ns}intentHandlingState> <{imo_ns}{report_data["intent_handling_state"]}>'
    elif 'intent_update_state' in report_data:
        turtle += f' ; <{icm_ns}intentUpdateState> <{imo_ns}{report_data["intent_update_state"]}>'

    # Add reason if present
    if report_data.get('reason'):
        turtle += f' ; <{icm_ns}reason> "{report_data["reason"]}"'

    # Close the turtle statement
    turtle += ' .'
    
    return turtle

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=True, port=port, host='0.0.0.0') 