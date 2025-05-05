from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import os
import sys
from datetime import datetime
import uuid
import json
from dotenv import load_dotenv
import requests
from observation_generator import ObservationGenerator

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

# Initialize the observation generator
observation_generator = ObservationGenerator(graphdb_url)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploaded_value_files')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/test')
def test():
    return render_template('test.html')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/intentReport')
def intent_report():
    return render_template('intentReport.html')

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
        
        # Only generate and store Turtle format for state change and update change reports
        if report_data.get('report_type') in ['STATE_CHANGE', 'UPDATE_CHANGE']:
            # Generate Turtle format
            turtle_data = generate_turtle(report_data)
            print(f"Generated Turtle data: {turtle_data}")  # Debug log
            
            # Store in GraphDB using the reports client
            response = reports_client.store_intent_report(turtle_data)
            print(f"GraphDB response: {response}")  # Debug log
        
        # If this is an expectation report with observation data, start observation generation
        if report_data.get('report_type') == 'EXPECTATION' and 'observation_data' in report_data:
            # Get the intent ID from the request data
            intent_id = report_data.get('intent_id')
            if not intent_id:
                return jsonify({"status": "error", "message": "intent_id is required for Expectation reports"}), 400
                
            # Get the full Turtle data from the intents repository
            turtle_data = intents_client.get_intent(intent_id)
            if not turtle_data:
                return jsonify({"status": "error", "message": f"Could not find intent with ID {intent_id}"}), 404
            
            print(f"Got Turtle data from intents repository: {turtle_data}")  # Debug log
            
            for observation in report_data['observation_data']:
                print(f"\n=== Starting observation generation ===")
                print(f"Condition ID: {observation['condition_id']}")
                print(f"Frequency: {observation['frequency']} seconds")
                print(f"Start Time: {observation['start_time']}")
                print(f"Stop Time: {observation['stop_time']}")
                start_time = datetime.fromisoformat(observation['start_time'].replace('Z', '+00:00'))
                stop_time = datetime.fromisoformat(observation['stop_time'].replace('Z', '+00:00'))
                min_value = observation.get('min_value', 10)
                max_value = observation.get('max_value', 100)
                value_file = observation.get('value_file')
                task_id = observation_generator.start_observation_task(
                    condition_id=observation['condition_id'],
                    frequency=observation['frequency'],
                    start_time=start_time,
                    stop_time=stop_time,
                    min_value=min_value,
                    max_value=max_value,
                    turtle_data=turtle_data,
                    value_file=value_file
                )
                print(f"Started observation task {task_id} for condition {observation['condition_id']}")
                print("=====================================\n")
        
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

@app.route('/api/get-report-by-number/<intent_id>/<report_number>')
def get_report_by_number(intent_id, report_number):
    try:
        # Use the reports_client to get the report by number
        report_data = reports_client.get_intent_report_by_number(intent_id, int(report_number))
        if not report_data:
            return jsonify({'error': f'No report found with number {report_number} for intent {intent_id}'}), 404
            
        return jsonify({'data': report_data})
    except Exception as e:
        print(f"Error getting report by number: {str(e)}")  # Debug log
        return jsonify({'error': str(e)}), 500

@app.route('/api/active-tasks', methods=['GET'])
def get_active_tasks():
    """Get information about all active observation tasks."""
    tasks = observation_generator.get_active_tasks()
    return jsonify(tasks)

@app.route('/api/update-task/<task_id>', methods=['POST'])
def update_task(task_id):
    """Update parameters for a running observation task."""
    data = request.json
    success = observation_generator.update_task_params(task_id, **data)
    if success:
        return jsonify({'status': 'success'})
    return jsonify({'error': 'Task not found'}), 404

@app.route('/api/last-observation-report/<intent_id>/<observed_metric>')
def get_last_observation_report(intent_id, observed_metric):
    """Return the last observation report for a given observed metric in Turtle format."""
    try:
        # Compose the SPARQL query
        query = f'''
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
        PREFIX data5g: <http://5g4data.eu/5g4data#>
        PREFIX met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/>

        SELECT ?observation ?value ?unit ?obtainedAt WHERE {{
          ?observation met:observedMetric data5g:{observed_metric} ;
                       met:observedValue ?valueNode ;
                       met:obtainedAt ?obtainedAt .
          ?valueNode rdf:value ?value ;
                     quan:unit ?unit .
        }}
        ORDER BY DESC(?obtainedAt)
        LIMIT 1
        '''
        response = requests.post(
            f"{reports_client.base_url}/repositories/{reports_client.repository}",
            data={"query": query},
            headers={"Accept": "application/sparql-results+json"}
        )
        if response.status_code != 200:
            return jsonify({"error": f"SPARQL query failed: {response.text}"}), 500
        results = response.json()
        bindings = results.get('results', {}).get('bindings', [])
        if not bindings:
            return jsonify({"data": "No observation report found."})
        b = bindings[0]
        # Format as Turtle
        turtle = f"""@prefix met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n@prefix data5g: <http://5g4data.eu/5g4data#> .\n\n"""
        turtle += f"{b['observation']['value']} a met:Observation ;\n    met:observedMetric data5g:{observed_metric} ;\n    met:observedValue [ rdf:value {b['value']['value']} ; quan:unit \"{b['unit']['value']}\" ] ;\n    met:obtainedAt \"{b['obtainedAt']['value']}\"^^xsd:dateTime .\n"
        return jsonify({"data": turtle})
    except Exception as e:
        print(f"Error getting last observation report: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/upload-value-file', methods=['POST'])
def upload_value_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    # Save the file with a unique name
    ext = os.path.splitext(file.filename)[1]
    filename = f"valuefile_{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    return jsonify({'filename': filename})

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
    
    # Ensure timestamp is properly formatted
    timestamp = report_data.get("report_generated", "")
    if timestamp:
        # If timestamp already has timezone, use it as is
        if '+' in timestamp or 'Z' in timestamp:
            turtle += f' <{icm_ns}reportGenerated> "{timestamp}"^^<{xsd_ns}dateTime>'
        else:
            # If no timezone, assume it's CET and add +01:00
            turtle += f' <{icm_ns}reportGenerated> "{timestamp}+01:00"^^<{xsd_ns}dateTime>'
    else:
        # If no timestamp provided, use current time in CET
        now = datetime.now()
        # Add CET timezone offset (+01:00)
        cet_time = now.strftime("%Y-%m-%dT%H:%M:%S+01:00")
        turtle += f' <{icm_ns}reportGenerated> "{cet_time}"^^<{xsd_ns}dateTime>'

    # Add handler if provided
    if report_data.get('handler'):
        turtle += f' ; <{imo_ns}handler> "{report_data["handler"]}"'

    # Add owner if provided
    if report_data.get('owner'):
        turtle += f' ; <{imo_ns}owner> "{report_data["owner"]}"'

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
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, port=port, host='0.0.0.0') 

