FROM python:3.12
WORKDIR /app

# Copy application code
COPY 5G4Data.py requirements.txt .
COPY templates/ templates/
COPY static/ static/

# Copy SSL certificates into the image under the names Gunicorn expects
# (or change these paths in the CMD below to match your filenames)
COPY certs/fullchain.pem /etc/ssl/certs/cert.pem
COPY certs/privkey.pem  /etc/ssl/certs/key.pem

# Install dependencies (make sure requirements.txt includes gunicorn)
RUN pip install --no-cache-dir -r requirements.txt

# Now expose standard HTTPS port
EXPOSE 443

# Launch Gunicorn, binding 0.0.0.0:443 with your cert + key
CMD [ "gunicorn", "--certfile", "/etc/ssl/certs/cert.pem", "--keyfile",  "/etc/ssl/certs/key.pem", "--bind",  "0.0.0.0:443", "5G4Data:app" ]


#CMD [ "gunicorn", "--bind", "0.0.0.0:5004", "5G4Data:app" ]

