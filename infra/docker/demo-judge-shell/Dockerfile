FROM alpine:3.20

RUN apk add --no-cache bash

COPY judge.sh /usr/local/bin/judge.sh
RUN chmod +x /usr/local/bin/judge.sh

ENTRYPOINT ["/usr/local/bin/judge.sh"]
