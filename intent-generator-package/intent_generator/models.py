"""Data models for intent generation parameters."""

from dataclasses import dataclass, field
from typing import Optional, Literal
from enum import Enum


class IntentType(Enum):
    """Supported intent types."""
    NETWORK = "network"
    WORKLOAD = "workload"
    COMBINED = "combined"


@dataclass
class BaseIntentParams:
    """Base parameters for all intent types."""
    description: Optional[str] = None
    handler: Optional[str] = None
    owner: Optional[str] = None
    customer: str = "+47 90914547"


@dataclass
class NetworkIntentParams(BaseIntentParams):
    """Parameters for network intent generation."""
    latency: float = 20.0
    latency_operator: Literal["smaller", "atLeast", "atMost", "greater", "inRange", "mean", "median"] = "smaller"
    latency_end: Optional[float] = None
    bandwidth: float = 300.0
    bandwidth_operator: Literal["larger", "atLeast", "atMost", "greater", "inRange", "mean", "median"] = "larger"
    bandwidth_end: Optional[float] = None
    location: Optional[str] = None
    polygon: Optional[str] = None


@dataclass
class WorkloadIntentParams(BaseIntentParams):
    """Parameters for workload intent generation."""
    compute_latency: float = 20.0
    compute_latency_operator: Literal["smaller", "atLeast", "atMost", "greater", "inRange", "mean", "median"] = "smaller"
    compute_latency_end: Optional[float] = None
    datacenter: str = "EC1"
    application: str = "AR-retail-app"
    descriptor: str = "http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml"


@dataclass
class CombinedIntentParams(BaseIntentParams):
    """Parameters for combined network and workload intent generation."""
    # Network parameters
    latency: float = 20.0
    latency_operator: Literal["smaller", "atLeast", "atMost", "greater", "inRange", "mean", "median"] = "smaller"
    latency_end: Optional[float] = None
    bandwidth: float = 300.0
    bandwidth_operator: Literal["larger", "atLeast", "atMost", "greater", "inRange", "mean", "median"] = "larger"
    bandwidth_end: Optional[float] = None
    location: Optional[str] = None
    polygon: Optional[str] = None
    
    # Workload parameters
    compute_latency: float = 20.0
    compute_latency_operator: Literal["smaller", "atLeast", "atMost", "greater", "inRange", "mean", "median"] = "smaller"
    compute_latency_end: Optional[float] = None
    datacenter: str = "EC1"
    application: str = "AR-retail-app"
    descriptor: str = "http://intend.eu/5G4DataWorkloadCatalogue/appx-deployment.yaml"
