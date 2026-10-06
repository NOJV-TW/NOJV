FROM python:3.14-slim@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2
WORKDIR /grade

# Bake the ANSWERS + grading code into the image. The answers live ONLY in this
# image — the grade container runs no student code, so they can never leak.
# The grade phase has no network. Install heavier comparison libraries (Pillow,
# numpy, librosa, ...) at image build time; runtime installation cannot work.
#
#   RUN pip install --no-cache-dir pillow numpy

COPY answers/ /answers/
COPY nojv_grader.py grader.py ./

USER 10001:10001
CMD ["python", "/grade/grader.py"]
