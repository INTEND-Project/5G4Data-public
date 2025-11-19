"""Turtle format generation utilities for intent reports."""

import uuid
from datetime import datetime
from typing import Dict, Any


def generate_turtle(report_data: Dict[str, Any]) -> str:
    """Generate Turtle format for an intent report.
    
    Args:
        report_data: Dictionary containing report data with keys:
            - intent_id: The ID of the intent
            - report_number: The report number
            - report_generated: Optional timestamp (ISO format)
            - handler: Optional handler name
            - owner: Optional owner name
            - intent_handling_state: Optional handling state
            - intent_update_state: Optional update state
            - reason: Optional reason text
    
    Returns:
        str: Turtle format RDF string for the intent report
    """
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

