FROM python:3.12-slim
WORKDIR /grade

# Bake the ANSWERS + grading code into the image. The answers live ONLY in this
# image — the grade container runs no student code, so they can never leak.

COPY answers/ /answers/
COPY nojv_grader.py grader.py ./

CMD ["python", "/grade/grader.py"]
