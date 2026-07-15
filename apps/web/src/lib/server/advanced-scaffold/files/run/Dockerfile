FROM python:3.14-slim@sha256:d3400aa122fa42cf0af0dbe8ec3091b047eac5c8f7e3539f7135e86d855dc015
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
