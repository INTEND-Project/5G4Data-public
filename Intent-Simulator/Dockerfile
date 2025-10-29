FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*

# Install intent-generator from local package first
COPY intent-generator-package /intent-generator-package
RUN pip install --no-cache-dir -e /intent-generator-package

# Copy requirements and install dependencies (excluding intent-generator)
COPY requirements.txt .
RUN sed -i '/intent-generator/d' requirements.txt && pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create intents directory
RUN mkdir -p intents

EXPOSE 3004
ENV FLASK_APP=app.py
ENV PYTHONPATH=/app

CMD ["gunicorn", "--bind", "0.0.0.0:3004", "--workers", "2", "--timeout", "120", "app:app"]