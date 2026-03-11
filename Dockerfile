FROM node:20-alpine

RUN apk add --no-cache curl wget bash

RUN apk add --no-cache yq

RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    chmod +x kubectl && \
    mv kubectl /usr/local/bin/


WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV DATABASE_URL="postgres://admin:password@db:5432/mydb"

EXPOSE 4001

CMD ["node", "index.ts"]