FROM python:3.14-slim@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d
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
