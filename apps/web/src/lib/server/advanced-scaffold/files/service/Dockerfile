FROM python:3.12-slim
WORKDIR /service

# The service has no runtime network access. Install every dependency while
# building the image, then keep it small — it runs alongside every submission's
# run container.
#
#   RUN pip install --no-cache-dir requests

COPY service.py ./

# The platform injects PORT=8888 and reaches the service there. Listen on $PORT
# and print NOJV_SERVICE_READY when ready.
EXPOSE 8888
USER 10001:10001
CMD ["python", "/service/service.py"]
