FROM python:3.12-slim
WORKDIR /run

# Bake the testcase INPUTS + the run harness into the image. Inputs are NOT
# secret (the student is allowed to see them). This demo runs a Python
# full-source submission (main.py) so no extra toolchain is needed.

COPY testcases/ /testcases/
COPY nojv_runner.py runner.py ./

CMD ["python", "/run/runner.py"]
