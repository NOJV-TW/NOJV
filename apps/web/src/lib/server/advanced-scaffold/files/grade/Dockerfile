FROM python:3.14-slim@sha256:d3400aa122fa42cf0af0dbe8ec3091b047eac5c8f7e3539f7135e86d855dc015
WORKDIR /grade

# Bake the ANSWERS + grading code into the image. The answers live ONLY in this
# image — the grade container runs no student code, so they can never leak.
# The grade phase has no network. Install heavier comparison libraries (Pillow,
# numpy, librosa, ...) at image build time; runtime installation cannot work.
#
#   RUN pip install --no-cache-dir pillow numpy

COPY answers/ /answers/
COPY nojv_grader.py grader.py ./

CMD ["python", "/grade/grader.py"]
