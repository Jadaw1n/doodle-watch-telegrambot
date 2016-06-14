FROM node:6

RUN mkdir /code
WORKDIR /code

ADD package.json /code

RUN npm install

ADD . /code

CMD npm start
