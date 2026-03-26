ARG STRFRY_REF=542552ab0f5234f808c52c21772b34f6f07bec65

FROM alpine:3.20 AS build

ARG STRFRY_REF

WORKDIR /build

RUN apk --no-cache add \
    linux-headers \
    git \
    g++ \
    make \
    perl \
    pkgconfig \
    libtool \
    ca-certificates \
    libressl-dev \
    zlib-dev \
    lmdb-dev \
    flatbuffers-dev \
    libsecp256k1-dev \
    zstd-dev

RUN git clone https://github.com/hoytech/strfry.git . \
    && git checkout ${STRFRY_REF} \
    && git submodule update --init \
    && make setup-golpe \
    && make -j4

FROM alpine:3.20

WORKDIR /app

RUN apk --no-cache add \
    lmdb \
    flatbuffers \
    libsecp256k1 \
    libb2 \
    zstd \
    libressl \
    perl

COPY --from=build /build/strfry /app/strfry
COPY rust/scripts/graph_relay_write_policy.pl /usr/local/bin/graph-relay-write-policy

RUN chmod +x /usr/local/bin/graph-relay-write-policy

EXPOSE 7777

ENTRYPOINT ["/app/strfry"]
CMD ["relay"]
