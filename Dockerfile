FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY assets/ /build/assets/
RUN npm run build

FROM python:3.13-slim-trixie@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b AS service
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PC_DATA_DIR=/var/lib/pi-control
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /var/lib/pi-control \
    && chown 10002:10002 /var/lib/pi-control
COPY backend/ backend/
COPY assets/ assets/
COPY --from=frontend /build/frontend/dist/ frontend/dist/
LABEL org.opencontainers.image.title="Pi Control" org.opencontainers.image.version="1.5.0"
USER 10002:10002
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3)"
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--no-access-log"]
