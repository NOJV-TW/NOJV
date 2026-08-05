FROM python:3.14-slim@sha256:cea0e6040540fb2b965b6e7fb5ffa00871e632eef63719f0ea54bca189ce14a6
WORKDIR /run

COPY infra/docker/demo-advanced-run/testcases/ /testcases/
COPY apps/web/src/lib/server/advanced-scaffold/files/run/nojv_runner.py /run/nojv_runner.py
COPY infra/docker/demo-advanced-run/runner.py /run/runner.py

CMD ["python", "/run/runner.py"]
