FROM node:14-alpine
RUN apk update && apk add zip && apk add tar && apk cache --purge
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY package*.json /usr/src/app/
RUN npm install --only=prod
COPY . /usr/src/app
EXPOSE 5000
CMD [ "npm", "start" ]