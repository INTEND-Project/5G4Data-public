#!/usr/bin/env python3
"""
Generate intents from configuration file
"""

import requests
import json
import time
import logging
from typing import Dict, List, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class IntentGeneratorFromConfig:
    def __init__(self, config_file: str):
        """Initialize with configuration file"""
        with open(config_file, 'r') as f:
            self.config = json.load(f)
        
        self.api_url = f"{self.config['api_settings']['base_url']}/api/generate-intent"
        self.timeout = self.config['api_settings']['timeout']
        self.retry_attempts = self.config['api_settings']['retry_attempts']
        
    def generate_intent(self, intent_type: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
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
        
    def generate_intent_batch(self, intent_type: str, intents_config: List[Dict[str, Any]]) -> List[str]:
        """Generate a batch of intents of the same type"""
        generated_ids = []
        
        logger.info(f"Generating {len(intents_config)} {intent_type} intents...")
        
        for i, intent_config in enumerate(intents_config):
            try:
                logger.info(f"Generating {intent_type} intent {i+1}/{len(intents_config)}: {intent_config.get('description', 'No description')}")
                
                result = self.generate_intent(intent_type, intent_config)
                intent_id = result['intent_ids'][0]
                generated_ids.append(intent_id)
                
                logger.info(f"✅ Generated {intent_type} intent: {intent_id}")
                
                # Add interval between intents if configured
                interval = self.config['generation_settings']['interval_between_intents']
                if interval > 0 and i < len(intents_config) - 1:
                    logger.info(f"Waiting {interval} seconds before next intent...")
                    time.sleep(interval)
                    
            except Exception as e:
                logger.error(f"❌ Failed to generate {intent_type} intent {i+1}: {e}")
                if not self.config['generation_settings']['continue_on_error']:
                    raise
        
        return generated_ids
    
    def generate_all_intents(self) -> Dict[str, List[str]]:
        """Generate all intents according to configuration"""
        all_generated_ids = {}
        
        logger.info("Starting intent generation from configuration...")
        
        # Generate network intents
        if 'network_intents' in self.config['intent_generation']:
            network_ids = self.generate_intent_batch(
                'network', 
                self.config['intent_generation']['network_intents']
            )
            all_generated_ids['network'] = network_ids
            
            # Add interval between batches
            interval = self.config['generation_settings']['interval_between_batches']
            if interval > 0:
                logger.info(f"Waiting {interval} seconds before next batch...")
                time.sleep(interval)
        
        # Generate workload intents
        if 'workload_intents' in self.config['intent_generation']:
            workload_ids = self.generate_intent_batch(
                'workload', 
                self.config['intent_generation']['workload_intents']
            )
            all_generated_ids['workload'] = workload_ids
            
            # Add interval between batches
            interval = self.config['generation_settings']['interval_between_batches']
            if interval > 0:
                logger.info(f"Waiting {interval} seconds before next batch...")
                time.sleep(interval)
        
        # Generate combined intents
        if 'combined_intents' in self.config['intent_generation']:
            combined_ids = self.generate_intent_batch(
                'combined', 
                self.config['intent_generation']['combined_intents']
            )
            all_generated_ids['combined'] = combined_ids
        
        return all_generated_ids
    
    def save_results(self, results: Dict[str, List[str]], output_file: str = "generated_intents.json"):
        """Save generation results to file"""
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"Results saved to {output_file}")

def main():
    """Main function to run intent generation from config"""
    config_file = "intent-generation.json"
    
    try:
        # Initialize generator
        generator = IntentGeneratorFromConfig(config_file)
        
        # Generate all intents
        results = generator.generate_all_intents()
        
        # Save results
        generator.save_results(results)
        
        # Print summary
        logger.info("=== Generation Summary ===")
        total_generated = 0
        for intent_type, ids in results.items():
            logger.info(f"{intent_type.capitalize()} intents: {len(ids)}")
            total_generated += len(ids)
        
        logger.info(f"Total intents generated: {total_generated}")
        
    except FileNotFoundError:
        logger.error(f"Configuration file {config_file} not found!")
    except Exception as e:
        logger.error(f"Error during intent generation: {e}")

if __name__ == "__main__":
    main()