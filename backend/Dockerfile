FROM python:3.12-slim

# Install build deps for psycopg/supabase wheels, then clean up.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render passes PORT; Uvicorn binds to 0.0.0.0:$PORT.
ENV PORT=10000
EXPOSE 10000

# Default command runs the API. Render overrides this per service:
#   web   -> uvicorn app.main:app --host 0.0.0.0 --port $PORT
#   worker -> rq worker default --url $REDIS_URL
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
