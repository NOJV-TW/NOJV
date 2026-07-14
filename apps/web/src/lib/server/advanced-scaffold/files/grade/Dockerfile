FROM python:3.12-slim@sha256:c3d81d25b3154142b0b42eb1e61300024426268edeb5b5a26dd7ddf64d9daf28
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
