FROM python:3.14-slim@sha256:d3400aa122fa42cf0af0dbe8ec3091b047eac5c8f7e3539f7135e86d855dc015
WORKDIR /run

# Bake the testcase INPUTS + the run harness into the image. Inputs are NOT
# secret (the student is allowed to see them). This demo runs a Python
# full-source submission (main.py) so no extra toolchain is needed.

COPY testcases/ /testcases/
COPY nojv_runner.py runner.py ./

CMD ["python", "/run/runner.py"]
