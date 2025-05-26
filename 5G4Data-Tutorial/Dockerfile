FROM python:3.12
WORKDIR /app

COPY 5G4Data.py requirements.txt .
COPY templates/ templates/
COPY static/ static/
# The cert files are now used by Caddy and accessed using the Caddyfile and volume mounts (see docker-compose.yaml)
# COPY certs/fullchain.pem /etc/ssl/certs/cert.pem
# COPY certs/privkey.pem  /etc/ssl/certs/key.pem

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5003

CMD ["gunicorn", "--bind", "0.0.0.0:5003", "5G4Data:app"]
