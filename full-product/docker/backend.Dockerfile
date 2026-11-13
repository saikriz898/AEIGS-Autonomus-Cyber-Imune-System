FROM python:3.15-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
COPY backend/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir -c requirements.lock -r requirements.txt
COPY backend/ /app/
COPY data/dataset-manifest.json /app/data/dataset-manifest.json
RUN addgroup --system aegis && adduser --system --ingroup aegis aegis && mkdir -p /storage/uploads /storage/artifacts /storage/reports && chown -R aegis:aegis /storage /app
USER aegis
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
