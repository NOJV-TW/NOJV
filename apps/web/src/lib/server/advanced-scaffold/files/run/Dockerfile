FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2
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

USER 10001:10001
CMD ["python", "/run/runner.py"]
