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

    def generate_observation_turtle(self, condition_id: str, timestamp: datetime) -> str:
        """Generate a single observation report in Turtle format."""
        observation_id = f"OB{uuid.uuid4().hex}"
        
        # Format the timestamp in ISO 8601 format with Z timezone
        timestamp_str = timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")
        
        # Generate a random latency value between 10 and 100 ms
        import random
        latency_value = random.uniform(10, 100)
        
        turtle = f"""@prefix met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix data5g: <http://5g4data.eu/5g4data#> .

data5g:{observation_id} a met:Observation ;
    met:observedMetric data5g:Latency-{condition_id} ;
    met:observedValue [ rdf:value {latency_value:.1f} ; quan:unit "ms" ] ;
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
                            start_time: datetime, stop_time: datetime):
        """Generate observations for a condition at the specified frequency."""
        current_time = start_time
        
        while current_time <= stop_time and task_id in self.running_tasks:
            # Generate and store the observation
            turtle_data = self.generate_observation_turtle(condition_id, current_time)
            self.store_observation(turtle_data)
            
            # Wait for the next interval (frequency is now in seconds)
            time.sleep(frequency)
            current_time += timedelta(seconds=frequency)
        
        # Remove the task from running tasks when done
        if task_id in self.running_tasks:
            del self.running_tasks[task_id]

    def start_observation_task(self, condition_id: str, frequency: int, 
                             start_time: datetime, stop_time: datetime) -> str:
        """Start a new observation generation task."""
        task_id = str(uuid.uuid4())
        self.running_tasks[task_id] = True
        
        # Start the observation generation in a separate thread
        thread = threading.Thread(
            target=self.generate_observations,
            args=(task_id, condition_id, frequency, start_time, stop_time)
        )
        thread.daemon = True
        thread.start()
        
        return task_id

    def stop_observation_task(self, task_id: str):
        """Stop an observation generation task."""
        if task_id in self.running_tasks:
            self.running_tasks[task_id] = False 