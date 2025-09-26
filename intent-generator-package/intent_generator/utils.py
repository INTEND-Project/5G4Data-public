"""Utility functions for intent generation."""

import os
from typing import Optional
import openai


def get_polygon_from_location(location: str, api_key: Optional[str] = None) -> str:
    """Get a polygon for a location using OpenAI API.
    
    Args:
        location: The location name to get polygon for
        api_key: OpenAI API key (if not provided, will use OPENAI_API_KEY env var)
        
    Returns:
        WKT polygon string
        
    Raises:
        ValueError: If API key is not available
        Exception: If API call fails
    """
    try:
        # Default polygon template
        polygon_template = """I will give you a name of a place and you will have to find out where it is and you will give me a bounding box (5km by 5km) like this surrounding the place:
POLYGON((69.673545 18.921344, 69.673448 18.924026, 69.672195 18.923903, 69.672356 18.921052))
Only output the boundingbox, nothing else. The name of the place is: """
        
        # Add the location to the prompt
        prompt = polygon_template + location
        
        # Get API key
        if api_key is None:
            api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise ValueError("OPENAI_API_KEY environment variable is not set")
        
        # Call OpenAI API
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        # Extract the polygon from the response
        polygon = response.choices[0].message.content.strip()
        return polygon
        
    except Exception as e:
        raise Exception(f"Error getting polygon from location '{location}': {str(e)}")


def get_default_polygon() -> str:
    """Get the default polygon used when no location is specified."""
    return "POLYGON((69.673545 18.921344, 69.673448 18.924026, 69.672195 18.923903, 69.672356 18.921052))"


def validate_operator(operator: str, valid_operators: list) -> bool:
    """Validate that an operator is in the list of valid operators."""
    return operator in valid_operators


def get_operator_mapping() -> dict:
    """Get the mapping of operator strings to RDF properties."""
    from rdflib import Namespace
    
    quan = Namespace("http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/")
    
    return {
        "smaller": quan.smaller,
        "atLeast": quan.atLeast,
        "atMost": quan.atMost,
        "greater": quan.greater,
        "inRange": quan.inRange,
        "mean": quan.mean,
        "median": quan.median,
        "larger": quan.larger,
    }
