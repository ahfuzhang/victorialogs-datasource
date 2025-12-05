FROM node:20-alpine3.21

RUN apk update && apk upgrade
RUN apk add --update python3 make g++ # for Mac M1 processors
RUN apk add zip --no-cache bash bash-doc bash-completion libtool autoconf automake nasm pkgconfig libpng gcc make g++ zlib-dev gawk git openssh
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

RUN mkdir -p /app
WORKDIR /app
