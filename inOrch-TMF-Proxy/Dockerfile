FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    INSERV_PORT=3020

WORKDIR /opt/inorch-tmf-proxy

RUN adduser --disabled-password --gecos "" inorch

# Install Helm binary
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy and install intent-report-client first (local dependency)
COPY intent-report-client /tmp/intent-report-client
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir /tmp/intent-report-client

COPY src/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ .

USER inorch

EXPOSE 3020

CMD ["gunicorn", "--bind", "0.0.0.0:3020", "--timeout", "120", "--workers", "1", "--worker-class", "sync", "--limit-request-line", "8190", "--limit-request-fields", "100", "--limit-request-field_size", "8190", "--max-requests", "1000", "--max-requests-jitter", "50", "inorch_tmf_proxy.wsgi:app"]


