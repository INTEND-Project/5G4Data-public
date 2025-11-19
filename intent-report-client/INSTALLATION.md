# Installation Instructions

## For IntentReport-Simulator

To use this package in the IntentReport-Simulator project:

```bash
cd /path/to/5G4Data-public/IntentReport-Simulator
pip install -e ../intent-report-client
```

This installs the package in editable mode, so any changes to the package will be immediately available.

## For Other Projects

To use this package in any other project:

```bash
# From the repository root
cd /path/to/5G4Data-public/intent-report-client
pip install -e .
```

Or from your project directory:

```bash
pip install -e /path/to/5G4Data-public/intent-report-client
```

## Verify Installation

After installation, you should be able to import the package:

```python
from intent_report_client import GraphDbClient, PrometheusClient
```

If you get an import error, make sure the package is installed in your Python environment:

```bash
pip list | grep intent-report-client
```

