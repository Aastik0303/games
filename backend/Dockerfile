# syntax=docker/dockerfile:1.7
FROM python:3.12.10-slim-bookworm AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY requirements.txt .
RUN python -m venv /venv && /venv/bin/pip install -r requirements.txt

FROM python:3.12.10-slim-bookworm
ENV PATH=/venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PRISM_ENV=production
RUN groupadd --system prism && useradd --system --gid prism --home /app --shell /usr/sbin/nologin prism
WORKDIR /app
COPY --from=build /venv /venv
COPY --chown=prism:prism app ./app
COPY --chown=prism:prism migrations ./migrations
COPY --chown=prism:prism alembic.ini ./
USER prism
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/v1/health/live', timeout=2).status == 200 else 1)"
# One process per container; scale with replicas. --ws-max-size caps frames before the app sees them.
# Proxy headers are trusted only from the load balancer's network (FORWARDED_ALLOW_IPS).
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--ws-max-size", "65536", "--proxy-headers", "--no-server-header", "--timeout-graceful-shutdown", "20"]
