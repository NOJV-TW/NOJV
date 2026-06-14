FROM python:3.12-slim
WORKDIR /service

# The service is trusted and has full network, so you may install anything and
# even forward to a real upstream. Keep it small — it runs alongside every
# submission's run container.
#
#   RUN pip install --no-cache-dir requests

COPY service.py ./

# The platform injects PORT=8888 and reaches the service there. Listen on $PORT
# and print NOJV_SERVICE_READY when ready.
EXPOSE 8888
CMD ["python", "/service/service.py"]
