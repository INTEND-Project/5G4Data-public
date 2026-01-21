from __future__ import annotations

import logging
import re
from typing import Optional

import requests

try:
    from intent_report_client import GraphDbClient
except ImportError:
    GraphDbClient = None  # type: ignore


class InfrastructureService:
    """Service to query GraphDB for DataCenter connection information."""

    def __init__(
        self,
        graphdb_client: Optional["GraphDbClient"] = None,
        base_url: str = "http://start5g-1.cs.uit.no",
        port_base: int = 4000,
    ):
        self._graphdb_client = graphdb_client
        self._base_url = base_url
        self._port_base = port_base
        self._logger = logging.getLogger(self.__class__.__name__)
        self._cache: dict[str, str] = {}  # Cache DataCenter -> URL mappings

    def get_datacenter_url(self, datacenter: str) -> Optional[str]:
        """
        Get the inOrch-TMF-Proxy URL for a given DataCenter from GraphDB.
        
        Args:
            datacenter: DataCenter identifier (e.g., "EC21", "EC1")
            
        Returns:
            URL to the inOrch-TMF-Proxy instance for this DataCenter, or None if not found
            
        Raises:
            RuntimeError: If GraphDB is not available or not responding
        """
        # Check cache first
        if datacenter in self._cache:
            return self._cache[datacenter]
        
        # Get from GraphDB (required, no fallback)
        url = self._get_url_from_graphdb(datacenter)
        
        if not url:
            raise RuntimeError(
                f"Could not retrieve DataCenter URL for {datacenter} from GraphDB. "
                "GraphDB may be unavailable or DataCenter not found in infrastructure data."
            )
        
        self._logger.debug(
            "Retrieved DataCenter URL from GraphDB for %s: %s",
            datacenter,
            url,
        )
        
        # Cache the result
        self._cache[datacenter] = url
        
        return url

    def _get_url_from_graphdb(self, datacenter: str) -> Optional[str]:
        """
        Query GraphDB for DataCenter access URL.
        
        Returns the URL if found, None otherwise.
        
        Raises:
            RuntimeError: If GraphDB client is not available
        """
        if not self._graphdb_client:
            raise RuntimeError(
                f"GraphDB client not available. Cannot retrieve DataCenter URL for {datacenter}."
            )
        
        try:
            # Extract number from DataCenter identifier (e.g., "EC21" -> 21, "EC1" -> 1)
            match = re.search(r'EC[_\s]*(\d+)', datacenter, re.IGNORECASE)
            if not match:
                raise RuntimeError(
                    f"Could not extract number from DataCenter identifier: {datacenter}"
                )
            
            dc_number = match.group(1)
            
            # Try different GraphDB URI formats
            formats = [
                f"EC_{dc_number}",  # EC_21
                f"EC{dc_number}",   # EC21
                f"EC_{int(dc_number)}",  # EC_1 for EC1
            ]
            
            for dc_format in formats:
                try:
                    url = self._query_graphdb_for_datacenter(dc_format)
                    if url:
                        self._logger.info(
                            "Lookup: Found %s endpoint in inGraph: %s",
                            dc_format,
                            url,
                        )
                        return url
                except RuntimeError:
                    # Re-raise RuntimeError (GraphDB unavailable)
                    raise
                except Exception as exc:
                    # Continue to next format if this one fails
                    self._logger.debug(
                        "Failed to query GraphDB with format %s for %s: %s",
                        dc_format,
                        datacenter,
                        exc,
                    )
                    continue
            
            # None of the formats worked
            raise RuntimeError(
                f"DataCenter {datacenter} not found in GraphDB infrastructure data (tried formats: {formats})"
            )
            
        except RuntimeError:
            # Re-raise RuntimeError (GraphDB unavailable or other critical errors)
            raise
        except Exception as exc:
            self._logger.error(
                "Unexpected error querying GraphDB for DataCenter %s: %s",
                datacenter,
                exc,
                exc_info=True,
            )
            raise RuntimeError(
                f"Unexpected error querying GraphDB for {datacenter}: {str(exc)}"
            )

    def _query_graphdb_for_datacenter(self, dc_identifier: str) -> Optional[str]:
        """
        Query GraphDB for a specific DataCenter identifier.
        
        Args:
            dc_identifier: DataCenter identifier in GraphDB format (e.g., "EC_1", "EC21")
            
        Returns:
            Access URL if found, None otherwise
        """
        if not self._graphdb_client:
            raise RuntimeError(
                f"GraphDB client not available. Cannot query for {dc_identifier}."
            )
        
        try:
            # SPARQL query to get domain/access URL from infrastructure graph
            query = f"""
            PREFIX spo: <https://intendproject.eu/telenor/>
            PREFIX aeros: <https://aeros.eu/schema/>
            
            SELECT ?domain
            WHERE {{
              GRAPH <http://intendproject.eu/telenor/infra> {{
                spo:{dc_identifier} aeros:domain ?domain .
              }}
            }}
            """
            
            # Use the GraphDB client's query endpoint
            base_url = self._graphdb_client.base_url
            repository = self._graphdb_client.repository
            
            headers = {
                "Accept": "application/sparql-results+json",
                "Content-Type": "application/sparql-query",
            }
            
            response = requests.post(
                f"{base_url}/repositories/{repository}",
                data=query.encode("utf-8"),
                headers=headers,
                timeout=3,  # Short timeout to fail fast when GraphDB is unavailable
            )
            
            if response.status_code != 200:
                self._logger.error(
                    "GraphDB query failed with status %d for %s: %s",
                    response.status_code,
                    dc_identifier,
                    response.text[:200] if response.text else "no response body",
                )
                raise RuntimeError(
                    f"GraphDB query failed with status {response.status_code} for {dc_identifier}"
                )
            
            results = response.json()
            bindings = results.get("results", {}).get("bindings", [])
            
            if bindings:
                domain = bindings[0].get("domain", {}).get("value")
                if domain:
                    domain_str = str(domain)
                    self._logger.debug(
                        "Found domain in GraphDB for %s: %s",
                        dc_identifier,
                        domain_str,
                    )
                    # If domain is already a full URL, return it as-is
                    if domain_str.startswith("http://") or domain_str.startswith("https://"):
                        # It's already a full URL, ensure it ends with /
                        if not domain_str.endswith("/"):
                            domain_str = f"{domain_str}/"
                        return domain_str
                    else:
                        # It's just a domain name, construct URL
                        return f"http://{domain_str}/tmf-api/intentManagement/v5/"
            else:
                self._logger.debug(
                    "No domain found in GraphDB for %s (no bindings in result)",
                    dc_identifier,
                )
                return None
            
        except requests.exceptions.Timeout:
            self._logger.error(
                "GraphDB query timeout for %s: GraphDB is not responding",
                dc_identifier,
            )
            raise RuntimeError(
                f"GraphDB query timeout for {dc_identifier}. GraphDB is not responding."
            )
        except requests.exceptions.ConnectionError as exc:
            self._logger.error(
                "GraphDB connection error for %s: %s - GraphDB is not accessible",
                dc_identifier,
                exc,
            )
            raise RuntimeError(
                f"GraphDB connection error for {dc_identifier}: GraphDB is not accessible. {str(exc)}"
            )
        except Exception as exc:
            self._logger.error(
                "Error querying GraphDB for %s: %s",
                dc_identifier,
                exc,
                exc_info=True,
            )
            raise RuntimeError(
                f"Error querying GraphDB for {dc_identifier}: {str(exc)}"
            )

    def _construct_url_from_port(self, datacenter: str) -> Optional[str]:
        """
        Construct URL from port mapping based on DataCenter number.
        
        Port mapping: EC1 = 4001, EC2 = 4002, ..., EC21 = 4021, etc.
        Formula: port = 4000 + DataCenter number
        
        Args:
            datacenter: DataCenter identifier (e.g., "EC21", "EC1")
            
        Returns:
            Constructed URL or None if DataCenter number cannot be extracted
        """
        try:
            # Extract number from DataCenter identifier
            match = re.search(r'EC[_\s]*(\d+)', datacenter, re.IGNORECASE)
            if not match:
                self._logger.warning("Could not extract number from DataCenter: %s", datacenter)
                return None
            
            dc_number = int(match.group(1))
            
            # Validate range (EC1 to EC41)
            if dc_number < 1 or dc_number > 41:
                self._logger.warning(
                    "DataCenter number %d out of valid range (1-41): %s",
                    dc_number,
                    datacenter,
                )
                return None
            
            # Calculate port: 4000 + DataCenter number
            port = self._port_base + dc_number
            
            # Construct URL
            url = f"{self._base_url}:{port}/tmf-api/intentManagement/v5/"
            
            self._logger.debug(
                "Constructed URL for DataCenter %s (EC%d): %s",
                datacenter,
                dc_number,
                url,
            )
            
            return url
            
        except Exception as exc:
            self._logger.error(
                "Error constructing URL from port for DataCenter %s: %s",
                datacenter,
                exc,
                exc_info=True,
            )
            return None
