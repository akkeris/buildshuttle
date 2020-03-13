FROM node:12
RUN apt-get update && apt-get install zip=3.0-11+b1 unzip tar=1.29b-1.1 --yes --no-install-recommends && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY package*.json /usr/src/app/
RUN npm install
COPY . /usr/src/app
EXPOSE 5000
CMD [ "npm", "start" ]