FROM python:3.14-slim@sha256:cea0e6040540fb2b965b6e7fb5ffa00871e632eef63719f0ea54bca189ce14a6
WORKDIR /grade

COPY infra/docker/demo-advanced-grade/answers/ /answers/
COPY apps/web/src/lib/server/advanced-scaffold/files/grade/nojv_grader.py /grade/nojv_grader.py
COPY infra/docker/demo-advanced-grade/grader.py /grade/grader.py

CMD ["python", "/grade/grader.py"]
