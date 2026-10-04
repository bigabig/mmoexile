# syntax=docker/dockerfile:1
# A region's network position (Stage 4): owns a network namespace that other
# containers join (network_mode: service:region-<id>) and delays everything
# sent from it with tc netem, simulating the distance to that region.
FROM alpine:3.22
RUN apk add --no-cache iproute2-tc
CMD ["sh", "-c", "tc qdisc replace dev eth0 root netem delay ${LATENCY_MS:-0}ms && echo \"netem: +${LATENCY_MS:-0} ms on eth0\" && exec sleep infinity"]
