FROM node:8
RUN apt-get update && apt-get install zip=3.0-11+b1 unzip=6.0-21 tar=1.29b-1.1 --yes --no-install-recommends && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . /usr/src/app
RUN npm install
EXPOSE 5000
CMD [ "npm", "start" ]