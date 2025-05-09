# Use an official Python image as a base
FROM python:3.12

WORKDIR /app

# Copy application code
COPY 5G4Data.py requirements.txt . 
COPY templates/ templates/
COPY static/ static/

# Copy SSL certificates into the image
# (Assumes you have cert.pem and key.pem in a local certs/ directory)
COPY cert.pem /etc/ssl/certs/cert.pem
COPY key.pem  /etc/ssl/certs/key.pem

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5003
# Run with Gunicorn and SSL
CMD [
  "gunicorn",
  "--certfile=/etc/ssl/certs/cert.pem",
  "--keyfile=/etc/ssl/certs/key.pem"
  "-w", "4", 
  "-b", "0.0.0.0:5003",
  "5G4Data:app"
]
