FROM node:8
RUN apt-get update && apt-get install zip=3.0-8 unzip=6.0-16+deb8u3 tar=1.27.1-2+deb8u2 --yes --no-install-recommends && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . /usr/src/app
RUN npm install
EXPOSE 5000
CMD [ "npm", "start" ]