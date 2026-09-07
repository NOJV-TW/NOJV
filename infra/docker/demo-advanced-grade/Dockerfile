FROM python:3.14-slim@sha256:656d12e70054d5fda18a045e2494c96701e9792dd1445f95b3d038df954f57e9
WORKDIR /grade

COPY infra/docker/demo-advanced-grade/answers/ /answers/
COPY apps/web/src/lib/server/advanced-scaffold/files/grade/nojv_grader.py /grade/nojv_grader.py
COPY infra/docker/demo-advanced-grade/grader.py /grade/grader.py

CMD ["python", "/grade/grader.py"]
