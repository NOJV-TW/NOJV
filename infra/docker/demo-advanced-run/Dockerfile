FROM python:3.14-slim@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d
WORKDIR /run

COPY infra/docker/demo-advanced-run/testcases/ /testcases/
COPY apps/web/src/lib/server/advanced-scaffold/files/run/nojv_runner.py /run/nojv_runner.py
COPY infra/docker/demo-advanced-run/runner.py /run/runner.py

USER 10001:10001
CMD ["python", "/run/runner.py"]
