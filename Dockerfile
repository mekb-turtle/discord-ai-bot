FROM node:20

COPY . .
RUN npm i --omit=dev --no-package-lock
USER node

CMD ["node","./src/index.js"]