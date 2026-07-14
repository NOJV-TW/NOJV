FROM python:3.12-slim@sha256:c3d81d25b3154142b0b42eb1e61300024426268edeb5b5a26dd7ddf64d9daf28
WORKDIR /run

# Bake the testcase INPUTS + the run harness into the image. Inputs are NOT
# secret (the student is allowed to see them). This demo runs a Python
# full-source submission (main.py) so no extra toolchain is needed.

COPY testcases/ /testcases/
COPY nojv_runner.py runner.py ./

CMD ["python", "/run/runner.py"]
