from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import os
import sys
from datetime import datetime
import uuid
import json
from dotenv import load_dotenv
import requests
import subprocess
import re
import time
import logging
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

# Initialize GraphDB configuration
graphdb_url = os.getenv('GRAPHDB_URL', 'http://start5g-1:7200')
if not graphdb_url.startswith('http://'):
    graphdb_url = f'http://{graphdb_url}'

graphdb_repository = os.getenv('GRAPHDB_REPOSITORY', 'intent-reports')

print(f"Connecting to GraphDB at {graphdb_url}")
print(f"Using repository '{graphdb_repository}' for intents and intent-reports")

# Initialize clients using the unified repository
intents_client = IntentReportClient(graphdb_url, repository=graphdb_repository)
reports_client = IntentReportClient(graphdb_url, repository=graphdb_repository)

# Initialize the observation generator with the unified repository
observation_generator = ObservationGenerator(graphdb_url, repository=graphdb_repository)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class IntentGenerator:
    """Intent generation utility for the app"""
    
    def __init__(self, config_file: str = "intent-generation.json"):
        """Initialize with configuration file"""
        try:
            with open(config_file, 'r') as f:
                self.config = json.load(f)
        except FileNotFoundError:
            # Default configuration if file not found
            self.config = {
                "api_settings": {
                    "base_url": "http://localhost:3004",
                    "timeout": 30,
                    "retry_attempts": 3
                },
                "generation_settings": {
                    "interval_between_intents": 1.0,
                    "continue_on_error": True
                }
            }
        
        self.api_url = f"{self.config['api_settings']['base_url']}/api/generate-intent"
        self.timeout = self.config['api_settings']['timeout']
        self.retry_attempts = self.config['api_settings']['retry_attempts']
        
    def generate_intent(self, intent_type: str, parameters: dict) -> dict:
        """Generate a single intent with retry logic"""
        data = {
            "intent_type": intent_type,
            "parameters": parameters,
            "count": 1,
            "interval": 0
        }
        
        for attempt in range(self.retry_attempts):
            try:
                response = requests.post(
                    self.api_url, 
                    json=data, 
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                logger.warning(f"Attempt {attempt + 1} failed: {e}")
                if attempt < self.retry_attempts - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff
                else:
                    raise
    
    def generate_all_intents_from_config(self) -> list:
        """Generate intents using the full configuration from intent-generation.json"""
        generated_ids = []
        
        logger.info("Generating intents from configuration file...")
        
        # Generate network intents
        if 'intent_generation' in self.config and 'network_intents' in self.config['intent_generation']:
            network_intents = self.config['intent_generation']['network_intents']
            logger.info(f"Generating {len(network_intents)} network intents...")
            
            for i, intent_config in enumerate(network_intents):
                try:
                    logger.info(f"Generating network intent {i+1}/{len(network_intents)}: {intent_config.get('description', 'No description')}")
                    
                    result = self.generate_intent('network', intent_config)
                    intent_id = result['intent_ids'][0]
                    generated_ids.append(intent_id)
                    logger.info(f"✅ Generated network intent: {intent_id}")
                    
                    # Add interval between intents if configured
                    interval = self.config['generation_settings'].get('interval_between_intents', 0)
                    if interval > 0 and i < len(network_intents) - 1:
                        time.sleep(interval)
                        
                except Exception as e:
                    logger.error(f"❌ Failed to generate network intent {i+1}: {e}")
                    if not self.config['generation_settings'].get('continue_on_error', True):
                        raise
        
        # Generate workload intents
        if 'intent_generation' in self.config and 'workload_intents' in self.config['intent_generation']:
            workload_intents = self.config['intent_generation']['workload_intents']
            logger.info(f"Generating {len(workload_intents)} workload intents...")
            
            # Add interval between batches
            interval = self.config['generation_settings'].get('interval_between_batches', 0)
            if interval > 0:
                logger.info(f"Waiting {interval} seconds before workload batch...")
                time.sleep(interval)
            
            for i, intent_config in enumerate(workload_intents):
                try:
                    logger.info(f"Generating workload intent {i+1}/{len(workload_intents)}: {intent_config.get('description', 'No description')}")
                    
                    result = self.generate_intent('workload', intent_config)
                    intent_id = result['intent_ids'][0]
                    generated_ids.append(intent_id)
                    logger.info(f"✅ Generated workload intent: {intent_id}")
                    
                    # Add interval between intents if configured
                    interval = self.config['generation_settings'].get('interval_between_intents', 0)
                    if interval > 0 and i < len(workload_intents) - 1:
                        time.sleep(interval)
                        
                except Exception as e:
                    logger.error(f"❌ Failed to generate workload intent {i+1}: {e}")
                    if not self.config['generation_settings'].get('continue_on_error', True):
                        raise
        
        # Generate combined intents
        if 'intent_generation' in self.config and 'combined_intents' in self.config['intent_generation']:
            combined_intents = self.config['intent_generation']['combined_intents']
            logger.info(f"Generating {len(combined_intents)} combined intents...")
            
            # Add interval between batches
            interval = self.config['generation_settings'].get('interval_between_batches', 0)
            if interval > 0:
                logger.info(f"Waiting {interval} seconds before combined batch...")
                time.sleep(interval)
            
            for i, intent_config in enumerate(combined_intents):
                try:
                    logger.info(f"Generating combined intent {i+1}/{len(combined_intents)}: {intent_config.get('description', 'No description')}")
                    
                    result = self.generate_intent('combined', intent_config)
                    intent_id = result['intent_ids'][0]
                    generated_ids.append(intent_id)
                    logger.info(f"✅ Generated combined intent: {intent_id}")
                    
                    # Add interval between intents if configured
                    interval = self.config['generation_settings'].get('interval_between_intents', 0)
                    if interval > 0 and i < len(combined_intents) - 1:
                        time.sleep(interval)
                        
                except Exception as e:
                    logger.error(f"❌ Failed to generate combined intent {i+1}: {e}")
                    if not self.config['generation_settings'].get('continue_on_error', True):
                        raise
        
        logger.info(f"Generated {len(generated_ids)} total intents from configuration")
        return generated_ids

# Initialize intent generator
intent_generator = IntentGenerator()

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploaded_value_files')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/test')
def test():
    return render_template('test.html')

@app.route('/')
def landing():
    return render_template('landing.html')

@app.route('/live')
def index():
    return render_template('index.html')

@app.route('/intentReport')
def intent_report():
    return render_template('intentReport.html')

@app.route('/populate')
def populate():
    return render_template('populate.html')

@app.route('/populate/configure', methods=['POST'])
def populate_configure():
    selected_intents = request.form.getlist('intent_ids')
    if not selected_intents:
        # No selection, redirect back to populate page
        return render_template('populate.html', error_message='Please select at least one intent.')
    return render_template('populate_configure.html', selected_intents=selected_intents)

def process_csv_to_graphdb(csv_path: str, intent_id: str, condition_id: str, turtle_data: str, debug_turtle_dir: str):
    """Process CSV file and insert observations into GraphDB."""
    import csv
    turtle_statements = []
    
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            # Skip comment lines
            rows = [row for row in reader if not (row and row[0].startswith('#'))]
            
            if len(rows) < 2:  # Need header + at least one data row
                return False, "No data rows found"
            
            # Skip header row
            data_rows = rows[1:]
            
            for row in data_rows:
                if len(row) >= 2:
                    timestamp_str, value_str = row[0], row[1]
                    try:
                        # Parse timestamp and value
                        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                        value = float(value_str)
                        
                        # Generate Turtle observation
                        turtle_obs = observation_generator.generate_observation_turtle(
                            condition_id=condition_id,
                            timestamp=timestamp,
                            min_value=0,  # Not used since we have actual value
                            max_value=0,  # Not used since we have actual value
                            turtle_data=turtle_data,
                            metric_value=value
                        )
                        turtle_statements.append(turtle_obs)
                        
                    except (ValueError, IndexError) as e:
                        print(f"Error parsing row {row}: {e}")
                        continue
            
            # Store all observations in GraphDB
            if turtle_statements:
                combined_turtle = '\n\n'.join(turtle_statements)
                
                # Store in GraphDB
                success = observation_generator.store_observation(combined_turtle, storage_type="graphdb")
                
                # Save debug Turtle file
                debug_file = os.path.join(debug_turtle_dir, f"{intent_id}__{condition_id}.ttl")
                with open(debug_file, 'w', encoding='utf-8') as f:
                    f.write(combined_turtle)
                
                return success, f"Stored {len(turtle_statements)} observations"
            else:
                return False, "No valid observations to store"
                
    except Exception as e:
        return False, f"Error processing CSV: {str(e)}"

@app.route('/populate/generate', methods=['POST'])
def populate_generate():
    try:
        # Directory where generated files will be stored
        output_dir = "/Users/arneme/CodeExplorations/INTEND-Project/5G4Data-public/IntentReport-Simulator/generated_observation_files"
        os.makedirs(output_dir, exist_ok=True)

        # Path to the generator script
        script_path = os.path.join(current_dir, 'generate_observation_file.py')

        # Group form fields by intent and condition
        grouped = {}
        for key, value in request.form.items():
            # Expect keys like: <intent>__<condition>__<field>
            parts = key.split('__')
            if len(parts) != 3:
                continue
            intent_id, condition_id, field = parts
            grouped.setdefault(intent_id, {}).setdefault(condition_id, {})[field] = value.strip()

        results = []
        # Cache intent turtle and parsed condition descriptions per intent
        intent_to_condition_desc = {}
        
        # Directory for debug Turtle files
        debug_turtle_dir = "/Users/arneme/CodeExplorations/INTEND-Project/5G4Data-public/IntentReport-Simulator/generated_observations"
        os.makedirs(debug_turtle_dir, exist_ok=True)

        def parse_condition_descriptions(turtle_text: str):
            """Return mapping condition_id -> description (if found) from turtle text."""
            condition_desc = {}
            current = None
            for line in turtle_text.split('\n'):
                if 'a icm:Condition' in line:
                    m = re.search(r'data5g:([^\s]+)\s+a\s+icm:Condition', line)
                    if m:
                        current = m.group(1)
                        if current not in condition_desc:
                            condition_desc[current] = None
                elif current and 'dct:description' in line:
                    m = re.search(r'dct:description\s+"([^"]+)"', line)
                    if m:
                        condition_desc[current] = m.group(1)
                        current = None
            return condition_desc

        for intent_id, conditions in grouped.items():
            # Ensure we have descriptions for this intent's conditions
            if intent_id not in intent_to_condition_desc:
                try:
                    turtle = intents_client.get_intent(intent_id) or ''
                    intent_to_condition_desc[intent_id] = parse_condition_descriptions(turtle)
                except Exception:
                    intent_to_condition_desc[intent_id] = {}
            for condition_id, fields in conditions.items():
                # Build CLI arguments based on available fields
                args = [
                    sys.executable,
                    script_path,
                ]

                def add_arg(flag, field_name, transform=None):
                    v = fields.get(field_name)
                    if v is None or v == '':
                        return
                    args.extend([flag, transform(v) if transform else v])

                add_arg('--start-time', 'start_time')
                add_arg('--end-time', 'end_time')
                add_arg('--frequency', 'frequency')
                add_arg('--min', 'min')
                add_arg('--max', 'max')
                add_arg('--mode', 'mode')
                add_arg('--decimal-places', 'decimal_places')

                # Anomaly options
                anomaly = fields.get('anomaly')
                if anomaly:
                    args.extend(['--anomaly', anomaly])
                    if anomaly in ('random', 'peak'):
                        add_arg('--anomaly-rate', 'anomaly_rate')
                    if anomaly == 'fixed':
                        add_arg('--anomaly-interval', 'anomaly_interval')
                    add_arg('--anomaly-duration-samples', 'anomaly_duration_samples')
                    add_arg('--anomaly-amplitude-frac', 'anomaly_amplitude_frac')
                    add_arg('--anomaly-direction', 'anomaly_direction')
                    add_arg('--peak-start-hour', 'peak_start_hour')
                    add_arg('--peak-end-hour', 'peak_end_hour')
                add_arg('--seed', 'seed')

                # Output file name: include intent and condition identifiers
                safe_intent = intent_id.replace(':', '_')
                safe_condition = condition_id.replace(':', '_')
                output_path = os.path.join(output_dir, f"{safe_intent}__{safe_condition}.csv")
                args.extend(['--output', output_path])

                # Run the generator script
                proc = subprocess.run(args, capture_output=True, text=True)
                if proc.returncode == 0:
                    # Prepend condition description comment if available
                    cond_desc = intent_to_condition_desc.get(intent_id, {}).get(condition_id)
                    if cond_desc:
                        try:
                            with open(output_path, 'r', encoding='utf-8') as f:
                                content = f.read()
                            header = f"# condition_description={cond_desc}\n"
                            with open(output_path, 'w', encoding='utf-8') as f:
                                f.write(header + content)
                        except Exception:
                            pass
                    
                    # Process CSV and insert into GraphDB
                    turtle_data = intents_client.get_intent(intent_id) or ''
                    graphdb_success, graphdb_message = process_csv_to_graphdb(output_path, intent_id, condition_id, turtle_data, debug_turtle_dir)
                    
                    # Script prints the output path; prefer our known path
                    results.append({
                        'intent_id': intent_id,
                        'condition_id': condition_id,
                        'status': 'success',
                        'file': output_path,
                        'graphdb_status': 'success' if graphdb_success else 'error',
                        'graphdb_message': graphdb_message
                    })
                else:
                    results.append({
                        'intent_id': intent_id,
                        'condition_id': condition_id,
                        'status': 'error',
                        'error': proc.stderr.strip() or 'Unknown error'
                    })

        return render_template('populate_generate_result.html', results=results, output_dir=output_dir)
    except Exception as e:
        return render_template('populate_generate_result.html', results=[{'status': 'error', 'error': str(e)}], output_dir='')

@app.route('/populate/quick-generate', methods=['POST'])
def quick_populate_generate():
    try:
        data = request.json
        conditions = data.get('conditions', [])
        
        if not conditions:
            return jsonify({'error': 'No conditions provided'}), 400
        
        # Check if intents exist, generate sample intents if none found
        try:
            results = intents_client.get_intents()
            intents = []
            for binding in results['results']['bindings']:
                intent = {
                    'id': binding['id']['value'],
                    'type': binding['type']['value']
                }
                intents.append(intent)
            
            if not intents:
                logger.info("No intents found during quick generation. Generating intents from configuration...")
                generated_ids = intent_generator.generate_all_intents_from_config()
                logger.info(f"Generated {len(generated_ids)} intents from configuration for quick generation")
                
        except Exception as intent_error:
            logger.warning(f"Could not check/generate intents: {intent_error}")
            # Continue with generation even if intent check fails
        
        # Directory where generated files will be stored
        output_dir = "/Users/arneme/CodeExplorations/INTEND-Project/5G4Data-public/IntentReport-Simulator/generated_observation_files"
        os.makedirs(output_dir, exist_ok=True)
        
        # Directory for debug Turtle files
        debug_turtle_dir = "/Users/arneme/CodeExplorations/INTEND-Project/5G4Data-public/IntentReport-Simulator/generated_observations"
        os.makedirs(debug_turtle_dir, exist_ok=True)
        
        # Path to the generator script
        script_path = os.path.join(current_dir, 'generate_observation_file.py')
        
        results = []
        
        # Generate state change events for each unique intent
        processed_intents = set()
        state_events_generated = []
        
        for condition in conditions:
            intent_id = condition['intent_id']
            condition_id = condition['condition_id']
            condition_description = condition['condition_description']
            storage_type = condition.get('storage_type', 'graphdb')
            
            # Generate state change events for this intent (only once per intent)
            if intent_id not in processed_intents:
                try:
                    # Parse the start time to use as base for state events
                    start_time = datetime.fromisoformat(condition['start_time'].replace('Z', '+00:00'))
                    
                    # Generate state change events
                    state_events = generate_state_change_events(
                        intent_id=intent_id,
                        start_time=start_time,
                        handler="inNet",  # Default handler
                        owner="inSwitch"  # Default owner
                    )
                    
                    # Store state events in GraphDB
                    for event in state_events:
                        try:
                            success = reports_client.store_intent_report(event['turtle'])
                            if success:
                                state_events_generated.append({
                                    'intent_id': intent_id,
                                    'state': event['state'],
                                    'timestamp': event['timestamp'].strftime("%Y-%m-%dT%H:%M:%SZ"),
                                    'status': 'success'
                                })
                                logger.info(f"Generated {event['state']} state event for intent {intent_id}")
                            else:
                                state_events_generated.append({
                                    'intent_id': intent_id,
                                    'state': event['state'],
                                    'timestamp': event['timestamp'].strftime("%Y-%m-%dT%H:%M:%SZ"),
                                    'status': 'error',
                                    'message': 'Failed to store in GraphDB'
                                })
                        except Exception as e:
                            logger.error(f"Failed to store state event {event['state']} for intent {intent_id}: {e}")
                            state_events_generated.append({
                                'intent_id': intent_id,
                                'state': event['state'],
                                'timestamp': event['timestamp'].strftime("%Y-%m-%dT%H:%M:%SZ"),
                                'status': 'error',
                                'message': str(e)
                            })
                    
                    processed_intents.add(intent_id)
                    
                except Exception as e:
                    logger.error(f"Failed to generate state events for intent {intent_id}: {e}")
                    state_events_generated.append({
                        'intent_id': intent_id,
                        'state': 'all',
                        'timestamp': condition['start_time'],
                        'status': 'error',
                        'message': f"Failed to generate state events: {str(e)}"
                    })
            
            # Randomly select generation mode and anomaly settings
            import random
            modes = ['random', 'diurnal', 'walk', 'trend']
            selected_mode = random.choice(modes)
            
            anomaly_strategies = ['none', 'random', 'fixed', 'peak']
            selected_anomaly = random.choice(anomaly_strategies) if condition.get('generate_anomalies', False) else 'none'
            
            # Build CLI arguments
            args = [
                sys.executable,
                script_path,
                '--start-time', condition['start_time'],
                '--end-time', condition['end_time'],
                '--frequency', condition['frequency'],
                '--min', str(condition['min_value']),
                '--max', str(condition['max_value']),
                '--mode', selected_mode,
                '--decimal-places', str(condition['decimal_places']),
                '--anomaly', selected_anomaly
            ]
            
            # Debug: Print the min/max values being used
            print(f"DEBUG: Using min={condition['min_value']}, max={condition['max_value']} for condition {condition_id}")
            
            # Add anomaly-specific parameters
            if selected_anomaly in ('random', 'peak'):
                args.extend(['--anomaly-rate', str(random.uniform(0.01, 0.05))])
            if selected_anomaly == 'fixed':
                intervals = ['1h', '2h', '4h', '6h', '12h']
                args.extend(['--anomaly-interval', random.choice(intervals)])
            
            args.extend([
                '--anomaly-duration-samples', str(random.randint(2, 5)),
                '--anomaly-amplitude-frac', str(random.uniform(0.2, 0.5)),
                '--anomaly-direction', random.choice(['spike', 'dip', 'both'])
            ])
            
            if selected_anomaly == 'peak':
                args.extend([
                    '--peak-start-hour', str(random.randint(14, 18)),
                    '--peak-end-hour', str(random.randint(19, 22))
                ])
            
            # Add random seed for reproducibility
            args.extend(['--seed', str(random.randint(1, 10000))])
            
            # Output file name
            safe_intent = intent_id.replace(':', '_')
            safe_condition = condition_id.replace(':', '_')
            output_path = os.path.join(output_dir, f"{safe_intent}__{safe_condition}.csv")
            args.extend(['--output', output_path])
            
            # Run the generator script
            proc = subprocess.run(args, capture_output=True, text=True)
            
            if proc.returncode == 0:
                # Prepend condition description comment
                try:
                    with open(output_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    header = f"# condition_description={condition_description}\n"
                    with open(output_path, 'w', encoding='utf-8') as f:
                        f.write(header + content)
                except Exception:
                    pass
                
                # Process CSV and insert into storage based on storage_type
                files_only = condition.get('files_only', False)
                if files_only:
                    storage_success, storage_message = False, "Skipped (files only)"
                else:
                    turtle_data = intents_client.get_intent(intent_id) or ''
                    
                    if storage_type == 'prometheus':
                        # Use observation generator for Prometheus storage
                        try:
                            # Start observation task for Prometheus storage
                            task_id = observation_generator.start_observation_task(
                                condition_id=condition_id,
                                frequency=int(condition['frequency']),
                                start_time=datetime.fromisoformat(condition['start_time'].replace('Z', '+00:00')),
                                stop_time=datetime.fromisoformat(condition['end_time'].replace('Z', '+00:00')),
                                min_value=condition['min_value'],
                                max_value=condition['max_value'],
                                turtle_data=turtle_data,
                                value_file=output_path,
                                original_value_file=output_path,
                                storage_type='prometheus',
                                honor_valuefile_timestamps=True
                            )
                            
                            # Store Prometheus metadata immediately
                            try:
                                metric_type, unit = observation_generator.get_metric_type_from_condition(condition_id, turtle_data)
                                metric_name = f"{metric_type.lower()}_{condition_id.lower()}"
                                reports_client.store_prometheus_metadata(metric_name=metric_name)
                            except Exception as meta_error:
                                logger.warning(f"Failed to store Prometheus metadata for {condition_id}: {meta_error}")
                            
                            storage_success, storage_message = True, f"Prometheus task started: {task_id}"
                        except Exception as e:
                            storage_success, storage_message = False, f"Prometheus error: {str(e)}"
                    else:
                        # Use GraphDB storage (default)
                        storage_success, storage_message = process_csv_to_graphdb(output_path, intent_id, condition_id, turtle_data, debug_turtle_dir)
                        
                        # Store GraphDB metadata immediately
                        if storage_success:
                            try:
                                metric_type, unit = observation_generator.get_metric_type_from_condition(condition_id, turtle_data)
                                metric_name = f"{metric_type.lower()}_{condition_id.lower()}"
                                reports_client.store_graphdb_metadata(metric_name=metric_name)
                            except Exception as meta_error:
                                logger.warning(f"Failed to store GraphDB metadata for {condition_id}: {meta_error}")
                
                results.append({
                    'intent_id': intent_id,
                    'condition_id': condition_id,
                    'condition_description': condition_description,
                    'status': 'success',
                    'file': output_path,
                    'mode': selected_mode,
                    'anomaly': selected_anomaly,
                    'files_only': files_only,
                    'storage_type': storage_type,
                    'storage_status': 'skipped' if files_only else ('success' if storage_success else 'error'),
                    'storage_message': storage_message
                })
            else:
                results.append({
                    'intent_id': intent_id,
                    'condition_id': condition_id,
                    'condition_description': condition_description,
                    'status': 'error',
                    'error': proc.stderr.strip() or 'Unknown error'
                })
        
        return jsonify({
            'results': results, 
            'output_dir': output_dir,
            'state_events': state_events_generated
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/populate/quick-result')
def quick_populate_result():
    results_json = request.args.get('results')
    if not results_json:
        return render_template('populate_generate_result.html', results=[], output_dir='')
    
    try:
        data = json.loads(results_json)
        # Expecting a JSON object like: { "results": [...], "output_dir": ":path", "state_events": [...] }
        results = data.get('results', []) if isinstance(data, dict) else []
        output_dir = data.get('output_dir', '') if isinstance(data, dict) else ''
        state_events = data.get('state_events', []) if isinstance(data, dict) else []
        return render_template('populate_generate_result.html', results=results, output_dir=output_dir, state_events=state_events)
    except Exception as e:
        return render_template('populate_generate_result.html', results=[{'status': 'error', 'error': str(e)}], output_dir='', state_events=[])

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
        
        # If no intents exist, generate intents from configuration
        if not intents:
            logger.info("No intents found in GraphDB. Generating intents from configuration...")
            try:
                generated_ids = intent_generator.generate_all_intents_from_config()
                logger.info(f"Generated {len(generated_ids)} intents from configuration")
                
                # Return a special response indicating intents were generated
                return jsonify({
                    'intents': [],
                    'message': f'Generated {len(generated_ids)} intents from configuration',
                    'generated_ids': generated_ids,
                    'generating': True
                })
                    
            except Exception as gen_error:
                logger.error(f"Failed to generate intents from config: {gen_error}")
                return jsonify({'error': f'No intents found and failed to generate intents from configuration: {str(gen_error)}'}), 500
        
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
                original_value_file = observation.get('original_value_file')
                task_id = observation_generator.start_observation_task(
                    condition_id=observation['condition_id'],
                    frequency=observation['frequency'],
                    start_time=start_time,
                    stop_time=stop_time,
                    min_value=min_value,
                    max_value=max_value,
                    turtle_data=turtle_data,
                    value_file=value_file,
                    original_value_file=original_value_file,
                    storage_type=observation.get('storage_type', 'graphdb'),
                    honor_valuefile_timestamps=observation.get('honor_valuefile_timestamps', False)
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

@app.route('/api/test-prometheus-connection')
def test_prometheus_connection():
    """Test connection to Prometheus server."""
    try:
        success = observation_generator.prometheus_client.test_connection()
        if success:
            return jsonify({"status": "success", "message": "Prometheus connection successful"})
        else:
            return jsonify({"status": "error", "message": "Prometheus connection failed"}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/local-prometheus-metrics')
def get_local_prometheus_metrics():
    """Get locally stored Prometheus metrics."""
    try:
        metrics = observation_generator.prometheus_client.get_local_metrics()
        return jsonify({"status": "success", "metrics": metrics})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

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
    # Save the file with a unique prefix but keep the original name
    original_filename = file.filename
    ext = os.path.splitext(file.filename)[1]
    filename = f"valuefile_{uuid.uuid4().hex}_{original_filename}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    return jsonify({'filename': filename, 'original_filename': original_filename})

@app.route('/api/prometheus-metadata/<condition_id>')
def get_prometheus_metadata(condition_id):
    """Get Prometheus query metadata for a condition."""
    try:
        metadata = reports_client.get_prometheus_metadata(condition_id)
        if metadata:
            return jsonify({
                "status": "success",
                "condition_id": condition_id,
                "prometheus_query_url": metadata['query_url'],
                "readable_query": metadata['readable_query']
            })
        else:
            return jsonify({
                "status": "error",
                "message": f"No Prometheus metadata found for condition {condition_id}"
            }), 404
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/generate-intents-from-config', methods=['POST'])
def generate_intents_from_config():
    """Manually generate all intents from intent-generation.json configuration"""
    try:
        generated_ids = intent_generator.generate_all_intents_from_config()
        return jsonify({
            'status': 'success',
            'message': f'Generated {len(generated_ids)} intents from configuration',
            'intent_ids': generated_ids
        })
    except Exception as e:
        logger.error(f"Failed to generate intents from config: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/storage-metadata/<condition_id>')
def get_storage_metadata(condition_id):
    """Get storage metadata for a condition (GraphDB vs Prometheus)."""
    try:
        # First check if Prometheus metadata exists
        prometheus_metadata = reports_client.get_prometheus_metadata(condition_id)
        
        if prometheus_metadata:
            # Data is stored in Prometheus
            return jsonify({
                "status": "success",
                "condition_id": condition_id,
                "storage_type": "prometheus",
                "prometheus_query_url": prometheus_metadata['query_url'],
                "readable_query": prometheus_metadata['readable_query']
            })
        else:
            # Data is stored in GraphDB (default)
            return jsonify({
                "status": "success", 
                "condition_id": condition_id,
                "storage_type": "graphdb"
            })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def generate_state_change_events(intent_id: str, start_time: datetime, handler: str = "inNet", owner: str = "inSwitch"):
    """Generate a sequence of state change events for quick populate simulation"""
    import random
    import time
    from datetime import timedelta
    
    events = []
    current_time = start_time
    
    # Event 1: IntentReceived (immediately)
    report_data = {
        "intent_id": intent_id,
        "report_type": "STATE_CHANGE",
        "report_number": 1,
        "report_generated": current_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "handler": handler,
        "owner": owner,
        "intent_handling_state": "StateIntentReceived",
        "reason": "Intent received and being processed"
    }
    turtle_data = generate_turtle(report_data)
    events.append({
        "state": "IntentReceived",
        "timestamp": current_time,
        "turtle": turtle_data
    })
    
    # Event 2: IntentAccepted (after random delay, max 5 minutes)
    delay_minutes = random.uniform(1, 5)  # Random delay between 1-5 minutes
    current_time += timedelta(minutes=delay_minutes)
    
    report_data = {
        "intent_id": intent_id,
        "report_type": "STATE_CHANGE", 
        "report_number": 2,
        "report_generated": current_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "handler": handler,
        "owner": owner,
        "intent_handling_state": "StateIntentAccepted",
        "reason": "Intent accepted and implementation started"
    }
    turtle_data = generate_turtle(report_data)
    events.append({
        "state": "IntentAccepted",
        "timestamp": current_time,
        "turtle": turtle_data
    })
    
    # Event 3: Complies (after random delay, max 5 minutes)
    delay_minutes = random.uniform(1, 5)  # Random delay between 1-5 minutes
    current_time += timedelta(minutes=delay_minutes)
    
    report_data = {
        "intent_id": intent_id,
        "report_type": "STATE_CHANGE",
        "report_number": 3,
        "report_generated": current_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "handler": handler,
        "owner": owner,
        "intent_handling_state": "StateCompliant",
        "reason": "Intent is now compliant and operational"
    }
    turtle_data = generate_turtle(report_data)
    events.append({
        "state": "Complies",
        "timestamp": current_time,
        "turtle": turtle_data
    })
    
    return events

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

