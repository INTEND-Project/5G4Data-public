import uuid
from datetime import datetime, timedelta
import time
import threading
from typing import List, Dict
import requests

class ObservationGenerator:
    def __init__(self, graphdb_url: str, repository: str = "intent-reports"):
        self.graphdb_url = graphdb_url
        self.repository = repository
        self.running_tasks = {}

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
        # Example: data5g:NetworkLatency-CO304d2f9509b349108f300a805bb3887f
        metric_match = target_property_line.split('data5g:')[1].split('-')[0]
        
        # Determine the unit based on the metric type
        if "Latency" in metric_match:
            return metric_match, "ms"
        elif "Bandwidth" in metric_match:
            return metric_match, "Mbps"
        else:
            return "Unknown", "NA"  # Default if type not recognized

    def generate_observation_turtle(self, condition_id: str, timestamp: datetime, min_value: float = 10, max_value: float = 100, turtle_data: str = "") -> str:
        """Generate a single observation report in Turtle format."""
        observation_id = f"OB{uuid.uuid4().hex}"
        
        # Format the timestamp in ISO 8601 format with Z timezone
        timestamp_str = timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")
        
        # Generate a random metric value between min_value and max_value
        import random
        metric_value = random.uniform(min_value, max_value)
        
        # Determine the metric type and unit from the condition's Turtle data
        metric_prefix, unit = self.get_metric_type_from_condition(condition_id, turtle_data)
        
        turtle = f"""@prefix met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix data5g: <http://5g4data.eu/5g4data#> .

data5g:{observation_id} a met:Observation ;
    met:observedMetric data5g:{metric_prefix}-{condition_id} ;
    met:observedValue [ rdf:value {metric_value:.1f} ; quan:unit "{unit}" ] ;
    met:obtainedAt "{timestamp_str}"^^xsd:dateTime ."""
        
        return turtle

    def store_observation(self, turtle_data: str) -> bool:
        """Store an observation report in GraphDB."""
        try:
            response = requests.post(
                f"{self.graphdb_url}/repositories/{self.repository}/statements",
                headers={"Content-Type": "application/x-turtle"},
                data=turtle_data
            )
            return response.status_code == 204
        except Exception as e:
            print(f"Error storing observation: {str(e)}")
            return False

    def generate_observations(self, task_id: str, condition_id: str, frequency: int, 
                            start_time: datetime, stop_time: datetime, min_value: float = 10, 
                            max_value: float = 100, turtle_data: str = ""):
        """Generate observations for a condition at the specified frequency."""
        current_time = start_time
        
        while current_time <= stop_time and task_id in self.running_tasks:
            # Generate and store the observation
            report_data = self.generate_observation_turtle(condition_id, current_time, min_value, max_value, turtle_data)
            print(f"Report data: {report_data}")
            self.store_observation(report_data)
            
            # Wait for the next interval (frequency is now in seconds)
            time.sleep(frequency)
            current_time += timedelta(seconds=frequency)
        
        # Remove the task from running tasks when done
        if task_id in self.running_tasks:
            del self.running_tasks[task_id]

    def start_observation_task(self, condition_id: str, frequency: int, 
                             start_time: datetime, stop_time: datetime, min_value: float = 10, 
                             max_value: float = 100, turtle_data: str = "") -> str:
        """Start a new observation generation task."""
        task_id = str(uuid.uuid4())
        self.running_tasks[task_id] = True
        
        # Start the observation generation in a separate thread
        thread = threading.Thread(
            target=self.generate_observations,
            args=(task_id, condition_id, frequency, start_time, stop_time, min_value, max_value, turtle_data)
        )
        thread.daemon = True
        thread.start()
        
        return task_id

    def stop_observation_task(self, task_id: str):
        """Stop an observation generation task."""
        if task_id in self.running_tasks:
            self.running_tasks[task_id] = False 