FROM python:3.14-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home fieldops
COPY migrations/ migrations/
COPY ingestion-worker/ ingestion-worker/
USER fieldops
CMD ["python", "ingestion-worker/worker.py"]
