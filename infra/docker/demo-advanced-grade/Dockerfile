FROM python:3.14-slim@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d
WORKDIR /grade

COPY infra/docker/demo-advanced-grade/answers/ /answers/
COPY apps/web/src/lib/server/advanced-scaffold/files/grade/nojv_grader.py /grade/nojv_grader.py
COPY infra/docker/demo-advanced-grade/grader.py /grade/grader.py

USER 10001:10001
CMD ["python", "/grade/grader.py"]
