FROM node:erbium-slim

ADD index.js /home/debian/index.js
ADD package.json /home/debian/package.json
ADD package-lock.json /home/debian/package-lock.json
ADD public /home/debian/public

WORKDIR /home/debian

RUN npm i -g pm2
RUN npm ci

EXPOSE 3000

CMD pm2-runtime index.js
