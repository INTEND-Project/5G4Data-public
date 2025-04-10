from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
import os
from dotenv import load_dotenv
from shared.intent_generator import IntentGenerator
from shared.graphdb_client import GraphDBClient
import time

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

# Initialize clients
intent_generator = IntentGenerator()
graphdb_client = GraphDBClient(os.getenv('GRAPHDB_URL'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/generate-intent', methods=['POST'])
def generate_intent():
    try:
        data = request.get_json()
        print("Received data:", data)  # Debug print
        intent_type = data.get('intent_type')
        parameters = data.get('parameters', {})
        count = int(data.get('count', 1))
        interval = float(data.get('interval', 0))

        if count > 1:
            intents = intent_generator.generate_sequence(intent_type, parameters, count, interval)
            intent_ids = []
            for intent in intents:
                intent_id = graphdb_client.store_intent(intent)
                intent_ids.append(intent_id)
            return jsonify({
                "message": f"Generated and stored {count} intents",
                "intent_ids": intent_ids
            })
        else:
            intent = intent_generator.generate(intent_type, parameters)
            intent_id = graphdb_client.store_intent(intent)
            return jsonify({
                "message": "Intent generated and stored successfully",
                "intent_ids": [intent_id]
            })
    except Exception as e:
        print(f"Error generating intent: {str(e)}")  # Debug print
        import traceback
        print(traceback.format_exc())  # Print full traceback
        return jsonify({"error": str(e)}), 400

@app.route('/api/get-intent/<intent_id>', methods=['GET'])
def get_intent(intent_id):
    try:
        intent_data = graphdb_client.get_intent(intent_id)
        if not intent_data:
            return jsonify({"error": f"No intent found with ID {intent_id}"}), 404
        print("Intent data:", intent_data)  # Debug print
        return jsonify({
            "intent_id": intent_id,
            "data": intent_data
        })
    except Exception as e:
        print("Error:", str(e))  # Debug print
        return jsonify({"error": str(e)}), 400

@app.route('/api/delete-all-intents', methods=['POST'])
def delete_all_intents():
    """Delete all intents from the repository and the intents directory"""
    try:
        # Delete all intents from GraphDB
        graphdb_client.delete_all_intents()
        
        # Delete all .ttl files from the intents directory
        intents_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'intents')
        for file in os.listdir(intents_dir):
            if file.endswith('.ttl'):
                file_path = os.path.join(intents_dir, file)
                try:
                    os.remove(file_path)
                    print(f"Deleted file: {file_path}")
                except Exception as e:
                    print(f"Error deleting file {file_path}: {str(e)}")
        
        return jsonify({"message": "All intents deleted successfully"})
    except Exception as e:
        print(f"Error deleting intents: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/intent-file/<path:filepath>')
def get_intent_file(filepath):
    """Serve the intent file content"""
    try:
        # Get the project root directory (one level up from backend)
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        # Construct the full path to the intent file
        full_path = os.path.join(project_root, "intents/", filepath)
        print(f"Attempting to read file: {full_path}")  # Debug print
        
        if not os.path.exists(full_path):
            print(f"File not found: {full_path}")  # Debug print
            return jsonify({"error": "File not found"}), 404
            
        return send_file(
            full_path,
            mimetype='text/turtle',
            as_attachment=False
        )
    except Exception as e:
        print(f"Error serving file: {str(e)}")  # Debug print
        return jsonify({"error": str(e)}), 404

@app.route('/api/query-intents')
def query_intents():
    """Query all intents with their details"""
    try:
        query = """
        PREFIX data5g: <http://5g4data.eu/5g4data#>
        PREFIX icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/>
        PREFIX log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/>
        
        SELECT DISTINCT ?intent ?id ?type ?sourceFile
        WHERE {
            ?intent a icm:Intent ;
                log:allOf ?de .
            ?de icm:target ?target .
            BIND(REPLACE(STR(?intent), ".*#I", "") AS ?id)
            BIND(IF(?target = data5g:network-slice, "Network",
                    IF(?target = data5g:deployment, "Workload",
                    IF(?target = data5g:network-slice && EXISTS { ?intent log:allOf data5g:RE2 }, "Combined", "Unknown"))) AS ?type)
            OPTIONAL {
                ?intent data5g:sourceFile ?sourceFile .
            }
            FILTER(STRSTARTS(STR(?de), "http://5g4data.eu/5g4data#DE"))
        }
        ORDER BY ?id
        """
        
        print("Executing SPARQL query:", query)  # Debug print
        results = graphdb_client.query_intents(query)
        print("Query results:", results)  # Debug print
        
        intents = []
        for binding in results['results']['bindings']:
            intent = {
                'id': binding['id']['value'],
                'type': binding['type']['value'],
                'sourceFile': binding.get('sourceFile', {}).get('value', '')
            }
            intents.append(intent)
        
        print("Processed intents:", intents)  # Debug print
        return jsonify({'intents': intents})
        
    except Exception as e:
        print(f"Error querying intents: {str(e)}")  # Debug print
        return jsonify({'error': str(e)}), 500

@app.route('/api/delete-intent/<intent_id>', methods=['DELETE'])
def delete_intent(intent_id):
    """Delete a specific intent and its associated file"""
    try:
        # Delete from GraphDB
        graphdb_client.delete_intent(intent_id)
        return jsonify({"message": f"Intent {intent_id} deleted successfully"})
    except Exception as e:
        print(f"Error deleting intent: {str(e)}")  # Debug print
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    app.run(debug=True) 