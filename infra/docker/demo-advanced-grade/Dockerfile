FROM python:3.14-slim@sha256:cae66f2ef0ec51a9891263eeee7f987dacf0a9879e8aa9353d5606e0530619a5
WORKDIR /grade

COPY infra/docker/demo-advanced-grade/answers/ /answers/
COPY apps/web/src/lib/server/advanced-scaffold/files/grade/nojv_grader.py /grade/nojv_grader.py
COPY infra/docker/demo-advanced-grade/grader.py /grade/grader.py

CMD ["python", "/grade/grader.py"]
