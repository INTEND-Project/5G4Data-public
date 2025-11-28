import requests
import json
from datetime import datetime
from typing import Optional, Dict, Any, List
import os

class PrometheusClient:
    def __init__(self, prometheus_url: str = None):
        """Initialize Prometheus client.
        
        Args:
            prometheus_url: URL of the Prometheus server. If None, will try to get from environment.
        """
        self.prometheus_url = prometheus_url or os.getenv('PROMETHEUS_URL', 'http://start5g-1.cs.uit.no:9090')
        if not self.prometheus_url.startswith('http'):
            self.prometheus_url = f'http://{self.prometheus_url}'
        
        # Remove trailing slash if present
        self.prometheus_url = self.prometheus_url.rstrip('/')
        
        print(f"Initialized Prometheus client with URL: {self.prometheus_url}")
        
        # Create metrics directory for local storage
        self.metrics_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'prometheus_metrics')
        os.makedirs(self.metrics_dir, exist_ok=True)
    
    def store_observation(self, metric_name: str, value: float, timestamp: datetime, 
                        labels: Optional[Dict[str, str]] = None) -> bool:
        """Store an observation in Prometheus format.
        
        Args:
            metric_name: Name of the metric (e.g., 'network_latency')
            value: Numeric value of the observation
            timestamp: When the observation was taken
            labels: Optional labels for the metric
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            # Convert timestamp to Unix timestamp (seconds since epoch)
            timestamp_unix = int(timestamp.timestamp())
            
            # Ensure value is not None
            if value is None:
                print(f"Warning: metric value is None for {metric_name}")
                value = 0.0  # Default value
            
            # Prepare the metric data in Prometheus exposition format
            metric_data = self._format_metric(metric_name, value, timestamp_unix, labels)
            print(f"Debug: Generated metric data: '{metric_data}'")
            
            # Try multiple approaches for storing metrics
            
            # Approach 1: Try using Prometheus Pushgateway (recommended for this use case)
            pushgateway_url = os.getenv('PUSHGATEWAY_URL', 'http://start5g-1.cs.uit.no:9091')
            try:
                # Pushgateway expects metrics in exposition format without timestamps
                # Add a newline at the end to ensure proper formatting
                pushgateway_metric = self._format_metric(metric_name, value, timestamp_unix, labels, include_timestamp=False)
                formatted_metric = pushgateway_metric + '\n'
                response = requests.post(
                    f"{pushgateway_url}/metrics/job/intent_reports",
                    headers={'Content-Type': 'text/plain'},
                    data=formatted_metric,
                    timeout=10
                )
                if response.status_code == 200:
                    print(f"Successfully stored observation via Pushgateway: {metric_name}={value}")
                    return True
                else:
                    print(f"Pushgateway failed. Status: {response.status_code}, Response: {response.text}")
                    print(f"Sent metric data: {formatted_metric}")
            except Exception as e:
                print(f"Pushgateway endpoint failed: {str(e)}")
            
            # Approach 2: Try direct remote write with proper content type
            try:
                response = requests.post(
                    f"{self.prometheus_url}/api/v1/write",
                    headers={'Content-Type': 'application/x-protobuf'},
                    data=metric_data,
                    timeout=10
                )
                if response.status_code == 200:
                    print(f"Successfully stored observation via remote write: {metric_name}={value}")
                    return True
                else:
                    print(f"Remote write failed. Status: {response.status_code}, Response: {response.text}")
            except Exception as e:
                print(f"Remote write endpoint failed: {str(e)}")
            
            # Approach 3: Fallback to local storage
            print(f"Direct Prometheus storage not available. Storing locally for manual import.")
            print(f"Metric data for manual import: {metric_data}")
            self._store_metric_locally(metric_data)
            return True
                
        except Exception as e:
            print(f"Error storing observation in Prometheus: {str(e)}")
            return False
    
    def _format_metric(self, metric_name: str, value: float, timestamp: int, 
                      labels: Optional[Dict[str, str]] = None, include_timestamp: bool = True) -> str:
        """Format metric data in Prometheus exposition format.
        
        Args:
            metric_name: Name of the metric
            value: Numeric value
            timestamp: Unix timestamp
            labels: Optional labels
            include_timestamp: Whether to include timestamp (False for Pushgateway)
            
        Returns:
            str: Formatted metric string
        """
        # Ensure metric name is valid (only alphanumeric and underscores)
        metric_name = ''.join(c for c in metric_name if c.isalnum() or c == '_')
        
        # Format labels if provided
        label_str = ""
        if labels:
            label_pairs = []
            for key, val in labels.items():
                # Ensure label names are valid
                key = ''.join(c for c in key if c.isalnum() or c == '_')
                # Escape quotes in label values
                val = val.replace('"', '\\"')
                label_pairs.append(f'{key}="{val}"')
            label_str = "{" + ",".join(label_pairs) + "}"
        
        # Format: metric_name{label1="value1",label2="value2"} value [timestamp]
        if include_timestamp:
            return f'{metric_name}{label_str} {value} {timestamp}'
        else:
            return f'{metric_name}{label_str} {value}'
    
    def test_connection(self) -> bool:
        """Test connection to Prometheus server.
        
        Returns:
            bool: True if connection successful, False otherwise
        """
        try:
            response = requests.get(f"{self.prometheus_url}/api/v1/status/config", timeout=5)
            return response.status_code == 200
        except Exception as e:
            print(f"Failed to connect to Prometheus: {str(e)}")
            return False
    
    def get_metric_value(self, metric_name: str, labels: Optional[Dict[str, str]] = None) -> Optional[float]:
        """Get the latest value for a metric.
        
        Args:
            metric_name: Name of the metric to query
            labels: Optional labels to filter by
            
        Returns:
            Optional[float]: The latest value, or None if not found
        """
        try:
            # Build query
            query = metric_name
            if labels:
                label_filters = []
                for key, val in labels.items():
                    label_filters.append(f'{key}="{val}"')
                if label_filters:
                    query += "{" + ",".join(label_filters) + "}"
            
            response = requests.get(
                f"{self.prometheus_url}/api/v1/query",
                params={'query': query},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data['status'] == 'success' and data['data']['result']:
                    # Return the first (most recent) value
                    return float(data['data']['result'][0]['value'][1])
            
            return None
            
        except Exception as e:
            print(f"Error querying Prometheus: {str(e)}")
            return None
    
    def _store_metric_locally(self, metric_data: str):
        """Store metric data in a local file for later collection.
        
        Args:
            metric_data: The formatted metric data to store
        """
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"metric_{timestamp}.txt"
            filepath = os.path.join(self.metrics_dir, filename)
            
            with open(filepath, 'w') as f:
                f.write(metric_data + '\n')
            
            print(f"Stored metric locally: {filepath}")
        except Exception as e:
            print(f"Error storing metric locally: {str(e)}")
    
    def get_local_metrics(self) -> List[str]:
        """Get all locally stored metrics.
        
        Returns:
            List[str]: List of metric data strings
        """
        metrics = []
        try:
            for filename in os.listdir(self.metrics_dir):
                if filename.startswith('metric_') and filename.endswith('.txt'):
                    filepath = os.path.join(self.metrics_dir, filename)
                    with open(filepath, 'r') as f:
                        metrics.extend(f.readlines())
        except Exception as e:
            print(f"Error reading local metrics: {str(e)}")
        return metrics

