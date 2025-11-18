FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    INSERV_PORT=3010

WORKDIR /opt/inserv

RUN adduser --disabled-password --gecos "" inserv

COPY src/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY src/ .

USER inserv

EXPOSE 3010

CMD ["gunicorn", "--bind", "0.0.0.0:3010", "inserv.wsgi:app"]


