import uuid
from datetime import datetime, timedelta
import time
import threading
from typing import List, Dict
import requests
from dataclasses import dataclass
import os
import sys

# Add parent directory to Python path to find shared module
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from shared.prometheus_client import PrometheusClient

@dataclass
class TaskParams:
    condition_id: str
    frequency: int
    start_time: datetime
    stop_time: datetime
    min_value: float = 10
    max_value: float = 100
    turtle_data: str = ""
    value_file: str = None
    original_value_file: str = None
    value_file_index: int = 0
    value_file_values: list = None
    value_file_timestamps: list = None
    storage_type: str = "graphdb"  # "graphdb" or "prometheus"

class ObservationGenerator:
    def __init__(self, graphdb_url: str, repository: str = None):
        self.graphdb_url = graphdb_url
        # Use env var default if not provided
        self.repository = repository or os.environ.get('GRAPHDB_REPOSITORY', 'intent-reports')
        self.running_tasks = {}  # task_id: {'params': TaskParams, 'thread': Thread}
        self.value_file_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploaded_value_files')
        
        # Initialize GraphDB client for metadata storage
        from shared.graphdb_client import IntentReportClient
        self.graphdb_client = IntentReportClient(graphdb_url, self.repository)
        
        # Initialize Prometheus client
        self.prometheus_client = PrometheusClient()

    def _parse_value_file(self, file_path: str) -> tuple[list, list]:
        """Parse a value file supporting two formats:
        1) One value per line (as-is current behavior)
        2) CSV with ISO8601 timestamp first, then value; optional header row
        Returns two aligned lists: timestamps (or None) and values (floats)
        """
        timestamps: list = []
        values: list = []
        def parse_iso8601(ts: str) -> datetime | None:
            ts = ts.strip()
            if not ts:
                return None
            try:
                # Support trailing Z as UTC
                if ts.endswith('Z'):
                    ts = ts.replace('Z', '+00:00')
                return datetime.fromisoformat(ts)
            except Exception:
                return None
        with open(file_path, 'r') as f:
            lines = [line.strip() for line in f if line.strip()]
        if not lines:
            return timestamps, values
        # Try detect CSV with header
        first = lines[0]
        # If first line contains letters and a comma, likely a header -> skip
        start_idx = 0
        if ',' in first:
            parts = [p.strip() for p in first.split(',', 1)]
            has_alpha = any(c.isalpha() for c in first)
            # Header if any alpha in either side and not parseable as timestamp,value
            if has_alpha:
                start_idx = 1
        for line in lines[start_idx:]:
            if ',' in line:
                left, right = [p.strip() for p in line.split(',', 1)]
                ts = parse_iso8601(left)
                try:
                    val = float(right)
                except Exception:
                    # Swap if reversed or malformed; fall back to single value parse
                    try:
                        ts_alt = parse_iso8601(right)
                        val = float(left)
                        ts = ts or ts_alt
                    except Exception:
                        # Skip unparseable line
                        continue
                timestamps.append(ts)
                values.append(val)
            else:
                # Single value per line
                try:
                    val = float(line)
                except Exception:
                    continue
                timestamps.append(None)
                values.append(val)
        return timestamps, values

    def get_metric_type_from_condition(self, condition_id: str, intent_data: str) -> tuple[str, str]:
        """Determine the metric type and unit from the condition's Turtle data.
        
        Args:
            condition_id: The condition ID to analyze
            turtle_data: The Turtle data containing the condition definition
            
        Returns:
            A tuple of (metric_prefix, unit) where:
            - metric_prefix is one of: "NetworkLatency", "ComputeLatency", "NetworkBandwidth"
            - unit is one of: "ms" for latency, "Mbps" for bandwidth
        """
        # Split the turtle data into lines
        lines = intent_data.split('\n')
        
        # Find the line containing the condition definition
        condition_line_index = -1
        for i, line in enumerate(lines):
            if f"data5g:{condition_id}" in line and "a icm:Condition" in line:
                condition_line_index = i
                break
        
        if condition_line_index == -1:
            return "Unknown", "NA"  # Default if condition not found
        
        # Continue parsing from the condition line
        target_property_line = None
        for line in lines[condition_line_index:]:
            if "icm:valuesOfTargetProperty" in line:
                target_property_line = line
                break
        
        if not target_property_line:
            return "Unknown", "NA"  # Default if property not found
        
        # Extract the metric type from the target property
        # Example: data5g:networklatency_co_304d2f9509b349108f300a805bb3887f
        metric_match = target_property_line.split('data5g:')[1].split('_co_')[0]
        
        # Determine the unit based on the metric type
        if "latency" in metric_match.lower():
            return metric_match, "ms"
        elif "bandwidth" in metric_match.lower():
            return metric_match, "Mbps"
        else:
            return "Unknown", "NA"  # Default if type not recognized

    def generate_observation_turtle(self, condition_id: str, timestamp: datetime, min_value: float = 10, max_value: float = 100, turtle_data: str = "", metric_value: float = None) -> str:
        """Generate a single observation report in Turtle format."""
        observation_id = f"OB{uuid.uuid4().hex}"
        timestamp_str = timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")
        import random
        if metric_value is None:
            metric_value = random.uniform(min_value, max_value)
        metric_prefix, unit = self.get_metric_type_from_condition(condition_id, turtle_data)
        turtle = f"""@prefix met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n@prefix data5g: <http://5g4data.eu/5g4data#> .\n\ndata5g:{observation_id} a met:Observation ;\n    met:observedMetric data5g:{metric_prefix}_{condition_id} ;\n    met:observedValue [ rdf:value {metric_value:.1f} ; quan:unit \"{unit}\" ] ;\n    met:obtainedAt \"{timestamp_str}\"^^xsd:dateTime ."""
        return turtle

    def store_observation(self, turtle_data: str, storage_type: str = "graphdb", 
                        metric_name: str = None, metric_value: float = None, 
                        timestamp: datetime = None, labels: Dict[str, str] = None) -> bool:
        """Store an observation report in GraphDB or Prometheus.
        
        Args:
            turtle_data: Turtle format data for GraphDB storage
            storage_type: "graphdb" or "prometheus"
            metric_name: Metric name for Prometheus storage
            metric_value: Metric value for Prometheus storage
            timestamp: Timestamp for Prometheus storage
            labels: Labels for Prometheus storage
        """
        if storage_type == "prometheus":
            return self._store_in_prometheus(metric_name, metric_value, timestamp, labels)
        else:
            return self._store_in_graphdb(turtle_data)
    
    def _store_in_graphdb(self, turtle_data: str) -> bool:
        """Store an observation report in GraphDB."""
        try:
            response = requests.post(
                f"{self.graphdb_url}/repositories/{self.repository}/statements",
                headers={"Content-Type": "application/x-turtle"},
                data=turtle_data
            )
            return response.status_code == 204
        except Exception as e:
            print(f"Error storing observation in GraphDB: {str(e)}")
            return False
    
    def _store_in_prometheus(self, metric_name: str, metric_value: float, 
                            timestamp: datetime, labels: Dict[str, str] = None) -> bool:
        """Store an observation report in Prometheus."""
        try:
            return self.prometheus_client.store_observation(metric_name, metric_value, timestamp, labels)
        except Exception as e:
            print(f"Error storing observation in Prometheus: {str(e)}")
            return False

    def generate_observations(self, task_id: str):
        task_info = self.running_tasks.get(task_id)
        if not task_info:
            return
        params = task_info['params']
        current_time = params.start_time
        # If value_file is provided, read values from file once
        if getattr(params, 'value_file', None) and params.value_file_values is None:
            value_file_path = os.path.join(self.value_file_dir, params.value_file)
            if os.path.exists(value_file_path):
                params.value_file_timestamps, params.value_file_values = self._parse_value_file(value_file_path)
            else:
                params.value_file_values = []
                params.value_file_timestamps = [] # Ensure timestamps are also empty if file not found
            params.value_file_index = 0
        while current_time <= params.stop_time and task_id in self.running_tasks:
            params = self.running_tasks[task_id]['params']
            honor_ts = self.running_tasks[task_id].get('honor_valuefile_timestamps', False)
            metric_value = None
            if getattr(params, 'value_file_values', None):
                if params.value_file_index < len(params.value_file_values):
                    metric_value = params.value_file_values[params.value_file_index]
                    # If honoring timestamps and a timestamp exists for this index, use it
                    if honor_ts and params.value_file_timestamps and params.value_file_index < len(params.value_file_timestamps):
                        ts = params.value_file_timestamps[params.value_file_index]
                        if ts is not None:
                            current_time = ts
                    params.value_file_index += 1
                else:
                    # If out of values, just use the last value
                    metric_value = params.value_file_values[-1] if params.value_file_values else None
            
            # If no metric_value was set (no value file or empty file), generate a random value
            if metric_value is None:
                import random
                metric_value = random.uniform(params.min_value, params.max_value)
            if params.storage_type == "prometheus":
                # Store in Prometheus
                metric_type, unit = self.get_metric_type_from_condition(params.condition_id, params.turtle_data)
                metric_name = f"{metric_type.lower()}_{params.condition_id.lower()}"
                labels = {
                    "condition_id": params.condition_id,
                    "intent_id": self.extract_intent_id(params.turtle_data),
                    "unit": unit
                }
                self.store_observation(
                    turtle_data="",  # Not used for Prometheus
                    storage_type="prometheus",
                    metric_name=metric_name,
                    metric_value=metric_value,
                    timestamp=current_time,
                    labels=labels
                )
                
                # Store metadata in GraphDB for this condition (only once per condition)
                if not hasattr(self, '_metadata_stored') or params.condition_id not in getattr(self, '_metadata_stored', set()):
                    intent_id = self.extract_intent_id(params.turtle_data)
                    self.graphdb_client.store_prometheus_metadata(
                        metric_name=metric_name
                    )
                    # Track that we've stored metadata for this condition
                    if not hasattr(self, '_metadata_stored'):
                        self._metadata_stored = set()
                    self._metadata_stored.add(params.condition_id)
            else:
                # Store in GraphDB
                report_data = self.generate_observation_turtle(
                    params.condition_id,
                    current_time,
                    params.min_value,
                    params.max_value,
                    params.turtle_data,
                    metric_value=metric_value
                )
                print(f"Report data: {report_data}")
                self.store_observation(report_data, storage_type="graphdb")
                
                # Store metadata in GraphDB for this condition (only once per condition)
                if not hasattr(self, '_graphdb_metadata_stored') or params.condition_id not in getattr(self, '_graphdb_metadata_stored', set()):
                    metric_type, unit = self.get_metric_type_from_condition(params.condition_id, params.turtle_data)
                    metric_name = f"{metric_type.lower()}_{params.condition_id.lower()}"
                    self.graphdb_client.store_graphdb_metadata(metric_name=metric_name)
                    # Track that we've stored metadata for this condition
                    if not hasattr(self, '_graphdb_metadata_stored'):
                        self._graphdb_metadata_stored = set()
                    self._graphdb_metadata_stored.add(params.condition_id)
            time.sleep(params.frequency)
            current_time += timedelta(seconds=params.frequency)
        if task_id in self.running_tasks:
            del self.running_tasks[task_id]

    def start_observation_task(self, condition_id: str, frequency: int, start_time: datetime, stop_time: datetime, min_value: float = 10, max_value: float = 100, turtle_data: str = "", value_file: str = None, original_value_file: str = None, storage_type: str = "graphdb", honor_valuefile_timestamps: bool = False) -> str:
        task_id = str(uuid.uuid4())
        params = TaskParams(
            condition_id=condition_id,
            frequency=frequency,
            start_time=start_time,
            stop_time=stop_time,
            min_value=min_value,
            max_value=max_value,
            turtle_data=turtle_data,
            value_file=value_file,
            original_value_file=original_value_file,
            storage_type=storage_type
        )
        self.running_tasks[task_id] = {
            'params': params,
            'thread': None,
            'honor_valuefile_timestamps': honor_valuefile_timestamps
        }
        thread = threading.Thread(
            target=self.generate_observations,
            args=(task_id,)
        )
        thread.daemon = True
        thread.start()
        self.running_tasks[task_id]['thread'] = thread
        return task_id

    def stop_observation_task(self, task_id: str):
        """Stop an observation generation task."""
        if task_id in self.running_tasks:
            del self.running_tasks[task_id]

    def get_condition_description(self, condition_id: str, turtle_data: str) -> str:
        """Extract the full condition description from Turtle data."""
        lines = turtle_data.split('\n')
        
        # First get the metric type and unit
        metric_type, unit = self.get_metric_type_from_condition(condition_id, turtle_data)
        if metric_type == "Unknown":
            return f"{condition_id}: Unknown condition"
            
        # Find the condition line
        condition_line_index = -1
        for i, line in enumerate(lines):
            if f"data5g:{condition_id}" in line and "a icm:Condition" in line:
                condition_line_index = i
                break
        
        if condition_line_index == -1:
            return f"{condition_id}: Unknown condition"
            
        # Look for min and max values
        min_value = None
        max_value = None
        range_type = None
        
        # Process lines after the condition
        for i, line in enumerate(lines[condition_line_index:], start=condition_line_index):
            line = line.strip()
            
            if "set:forAll" in line:
                # Look for the inRange clause that belongs to this condition
                for next_line in lines[i+1:]:
                    next_line = next_line.strip()
                    if "quan:inRange" in next_line and f"data5g:{metric_type}_co_{condition_id}" in next_line:
                        range_type = "inRange"
                        # Look for values in subsequent lines
                        values = []
                        for value_line in lines[i+2:]:
                            value_line = value_line.strip()
                            if "rdf:value" in value_line:
                                value = value_line.split("rdf:value")[1].strip().rstrip("]").strip()
                                values.append(value)
                            elif "quan:unit" in value_line:
                                unit = value_line.split('"')[1]
                            elif ")" in value_line and len(values) >= 2:
                                break
                        
                        if len(values) >= 2:
                            min_value = values[0]
                            max_value = values[1]
                        break
                    elif "quan:atLeast" in next_line and f"data5g:{metric_type}_co_{condition_id}" in next_line:
                        range_type = "atLeast"
                        # Look for value in subsequent lines
                        for value_line in lines[i+2:]:
                            value_line = value_line.strip()
                            if "rdf:value" in value_line:
                                min_value = value_line.split("rdf:value")[1].strip().rstrip("]").strip()
                                break
                    elif "quan:atMost" in next_line and f"data5g:{metric_type}_co_{condition_id}" in next_line:
                        range_type = "atMost"
                        # Look for value in subsequent lines
                        for value_line in lines[i+2:]:
                            value_line = value_line.strip()
                            if "rdf:value" in value_line:
                                max_value = value_line.split("rdf:value")[1].strip().rstrip("]").strip()
                                break
                    elif "quan:unit" in next_line:
                        unit = next_line.split('"')[1]
                    elif "]" in next_line and not any(x in next_line for x in ["rdf:value", "quan:unit"]):
                        break
        
        # Construct the description
        description = f"{metric_type}_co_{condition_id} "
        
        if range_type == "inRange" and min_value and max_value:
            description += f"quan:inRange: {min_value} to {max_value}{unit}"
        elif range_type == "atLeast" and min_value:
            description += f"quan:atLeast: {min_value}{unit}"
        elif range_type == "atMost" and max_value:
            description += f"quan:atMost: {max_value}{unit}"
        else:
            description += f"condition"
            
        return description

    def extract_intent_id(self, turtle_data: str) -> str:
        """Extract the intent ID from the Turtle data."""
        for line in turtle_data.split('\n'):
            if 'a icm:Intent' in line:
                parts = line.strip().split()
                if parts and parts[0].startswith('data5g:'):
                    return parts[0].replace('data5g:', '').strip().replace('\n', '')
        return ''

    def get_active_tasks(self) -> List[Dict]:
        """Get information about all active tasks."""
        tasks = []
        for task_id, task_info in self.running_tasks.items():
            params = task_info['params']
            metric_type, unit = self.get_metric_type_from_condition(params.condition_id, params.turtle_data)
            condition_description = self.get_condition_description(params.condition_id, params.turtle_data)
            intent_id = self.extract_intent_id(params.turtle_data)
            task_data = {
                'task_id': task_id,
                'intent_id': intent_id,
                'condition_id': params.condition_id,
                'metric_type': metric_type,
                'unit': unit,
                'condition_description': condition_description,
                'frequency': params.frequency,
                'min_value': float(params.min_value),
                'max_value': float(params.max_value),
                'start_time': params.start_time.isoformat(),
                'stop_time': params.stop_time.isoformat(),
                'value_file': params.value_file,
                'original_value_file': params.original_value_file,
                'storage_type': params.storage_type
            }
            tasks.append(task_data)
        return tasks

    def update_task_params(self, task_id: str, **kwargs) -> bool:
        """Update parameters for a running task."""
        if task_id not in self.running_tasks:
            return False
            
        params = self.running_tasks[task_id]['params']
        for key, value in kwargs.items():
            if hasattr(params, key):
                if key in ['start_time', 'stop_time'] and isinstance(value, str):
                    value = datetime.fromisoformat(value)
                setattr(params, key, value)
        return True 