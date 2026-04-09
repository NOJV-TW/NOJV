FROM python:3.12-slim
# Your image must read /workspace/submission/, /workspace/testcases/N/,
# and /workspace/meta.json, and write /workspace/output/result.json.
WORKDIR /workspace
COPY . /app
ENTRYPOINT ["python", "/app/judge.py"]
