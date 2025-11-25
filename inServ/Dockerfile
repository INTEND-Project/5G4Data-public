FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    INSERV_PORT=3020

WORKDIR /opt/inserv

RUN adduser --disabled-password --gecos "" inserv

# Copy and install intent-report-client first (local dependency)
COPY intent-report-client /tmp/intent-report-client
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir /tmp/intent-report-client

COPY inServ/src/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY inServ/src/ .

USER inserv

EXPOSE 3020

CMD ["gunicorn", "--bind", "0.0.0.0:3020", "--timeout", "120", "--workers", "1", "--worker-class", "sync", "--limit-request-line", "8190", "--limit-request-fields", "100", "--limit-request-field_size", "8190", "--max-requests", "1000", "--max-requests-jitter", "50", "inserv.wsgi:app"]


