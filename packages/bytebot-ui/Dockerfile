# syntax=docker/dockerfile:1
# Base image
FROM node:20-alpine

# Declare build arguments
ARG BYTEBOT_AGENT_BASE_URL
ARG BYTEBOT_DESKTOP_VNC_URL

# Set environment variables for the build process
ENV BYTEBOT_AGENT_BASE_URL=${BYTEBOT_AGENT_BASE_URL}
ENV BYTEBOT_DESKTOP_VNC_URL=${BYTEBOT_DESKTOP_VNC_URL}

# Create app directory
WORKDIR /app

# Copy only dependency manifests first for better caching
COPY ./shared/package*.json ./shared/
COPY ./bytebot-ui/package*.json ./bytebot-ui/

# Install dependencies for the shared package
WORKDIR /app/shared
RUN npm ci

# Install dependencies for the UI
WORKDIR /app/bytebot-ui
RUN npm ci

# Copy the full source for both packages
COPY ./shared /app/shared
COPY ./bytebot-ui /app/bytebot-ui

# Build the UI (this script also rebuilds the shared package)
RUN npm run build

# Run the application
CMD ["npm", "run", "start"] 
