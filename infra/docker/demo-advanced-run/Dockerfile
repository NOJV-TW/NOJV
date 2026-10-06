FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2
WORKDIR /run

COPY infra/docker/demo-advanced-run/testcases/ /testcases/
COPY apps/web/src/lib/server/advanced-scaffold/files/run/nojv_runner.py /run/nojv_runner.py
COPY infra/docker/demo-advanced-run/runner.py /run/runner.py

USER 10001:10001
CMD ["python", "/run/runner.py"]
