FROM node:22-alpine
WORKDIR /app
COPY server.js .
COPY public/ public/
EXPOSE 3000
USER node
CMD ["node", "server.js"]
