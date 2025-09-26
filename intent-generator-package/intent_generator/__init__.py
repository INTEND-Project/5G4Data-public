"""Intent Generator Package for TM Forum Intent Creation.

This package provides functionality to generate TM Forum formatted intents
for 5G network and workload management scenarios.
"""

from .core import IntentGenerator
from .models import (
    NetworkIntentParams,
    WorkloadIntentParams,
    CombinedIntentParams,
    IntentType,
)

__version__ = "1.0.0"
__all__ = [
    "IntentGenerator",
    "NetworkIntentParams",
    "WorkloadIntentParams", 
    "CombinedIntentParams",
    "IntentType",
]
