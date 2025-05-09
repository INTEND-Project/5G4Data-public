FROM python:3.12
WORKDIR /app

# Copy application code
COPY 5G4Data.py requirements.txt .
COPY templates/ templates/
COPY static/ static/

# Copy SSL certificates into the image
COPY cert.pem /etc/ssl/certs/cert.pem
COPY key.pem  /etc/ssl/certs/key.pem

# Install dependencies (make sure requirements.txt includes gunicorn)
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5003

CMD [ "gunicorn", "--bind", "0.0.0.0:5003", "app:run_5G4Data()" ]
