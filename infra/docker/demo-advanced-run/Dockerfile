FROM python:3.14-slim@sha256:cae66f2ef0ec51a9891263eeee7f987dacf0a9879e8aa9353d5606e0530619a5
WORKDIR /run

COPY infra/docker/demo-advanced-run/testcases/ /testcases/
COPY apps/web/src/lib/server/advanced-scaffold/files/run/nojv_runner.py /run/nojv_runner.py
COPY infra/docker/demo-advanced-run/runner.py /run/runner.py

CMD ["python", "/run/runner.py"]
