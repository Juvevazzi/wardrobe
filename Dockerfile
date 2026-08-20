FROM node:22-slim
WORKDIR /app

# Install inside the container (not copied from the host) so sharp fetches
# the correct platform-specific binary for this image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV PORT=4173
ENV HOST=0.0.0.0
EXPOSE 4173
VOLUME /app/data

CMD ["node", "server/index.mjs"]
