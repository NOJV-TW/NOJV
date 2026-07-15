FROM python:3.12-slim@sha256:c3d81d25b3154142b0b42eb1e61300024426268edeb5b5a26dd7ddf64d9daf28
WORKDIR /grade

COPY infra/docker/demo-advanced-grade/answers/ /answers/
COPY apps/web/src/lib/server/advanced-scaffold/files/grade/nojv_grader.py /grade/nojv_grader.py
COPY infra/docker/demo-advanced-grade/grader.py /grade/grader.py

CMD ["python", "/grade/grader.py"]
