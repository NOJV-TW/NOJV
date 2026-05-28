FROM python:3.12-slim
WORKDIR /grader

# Bake testcases + grading code into the image. The judge runs with
# --network none, so nothing can be fetched at runtime — everything the
# grader needs (test data, extra pip packages) must be COPYed/installed here.
COPY testcases/ ./testcases/
COPY nojv_grader.py grader.py ./

CMD ["python", "/grader/grader.py"]
