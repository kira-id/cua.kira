# syntax=docker/dockerfile:1
# Base image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy app source
COPY ./shared ./shared
COPY ./bytebot-agent/ ./bytebot-agent/

WORKDIR /app/bytebot-agent

# Install dependencies with optimized settings
RUN npm config set fetch-timeout 600000
RUN npm install

RUN npm run build

# Run the application
CMD ["npm", "run", "start:prod"] 


