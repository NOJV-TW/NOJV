FROM python:3.14-slim@sha256:cae66f2ef0ec51a9891263eeee7f987dacf0a9879e8aa9353d5606e0530619a5
WORKDIR /run

# Bake the toolchain + testcase INPUTS + the run harness into the image.
# Inputs are not secret (the student is allowed to see them). The platform runs
# this image with at most one network peer, so anything you need at runtime
# (pip packages, compilers, test inputs) must be installed/COPYed here.
#
# For a compiled language add the toolchain, e.g.:
#   RUN apt-get update && apt-get install -y --no-install-recommends gcc \
#       && rm -rf /var/lib/apt/lists/*

COPY testcases/ /testcases/
COPY nojv_runner.py runner.py ./

CMD ["python", "/run/runner.py"]
