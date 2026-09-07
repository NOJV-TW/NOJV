FROM python:3.14-slim@sha256:656d12e70054d5fda18a045e2494c96701e9792dd1445f95b3d038df954f57e9
WORKDIR /run

COPY infra/docker/demo-advanced-run/testcases/ /testcases/
COPY apps/web/src/lib/server/advanced-scaffold/files/run/nojv_runner.py /run/nojv_runner.py
COPY infra/docker/demo-advanced-run/runner.py /run/runner.py

CMD ["python", "/run/runner.py"]
