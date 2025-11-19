# syntax=docker/dockerfile:1
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Python environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_ENV=production \
    PORT=5001

# Set working directory
WORKDIR /app

# Copy requirements first for better layer caching
COPY IntentReport-Simulator/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy and install the intent-report-client package
COPY intent-report-client /tmp/intent-report-client
RUN pip install --no-cache-dir -e /tmp/intent-report-client

# Copy the IntentReport-Simulator application
COPY IntentReport-Simulator/ .

# Expose the Flask port
EXPOSE 3005


# Run with gunicorn for production (using 2 workers for basic scaling)
CMD ["gunicorn", "--bind", "0.0.0.0:3005", "-w", "2",  "app:app"]

