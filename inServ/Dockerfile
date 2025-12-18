FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy and install intent-report-client from parent directory (single source of truth)
# Note: This Dockerfile must be built from the parent directory (5G4Data-public)
# Example: docker build -f inServ/Dockerfile -t inserv .
COPY intent-report-client /tmp/intent-report-client
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir /tmp/intent-report-client

# Copy requirements and install Python dependencies
COPY inServ/src/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY inServ/src/ /app/

# Expose port (default, can be overridden via INSERV_PORT env var)
EXPOSE 3021

# Run the application
# Use shell form to allow environment variable substitution for port
CMD gunicorn -w 4 -b "0.0.0.0:${INSERV_PORT:-3021}" --timeout 120 inserv.wsgi:app
