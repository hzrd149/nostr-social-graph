FROM node:20

WORKDIR /app

# Copy package files
COPY package*.json yarn.lock ./

# Install dependencies (skip prepare/postinstall scripts that try to build)
RUN yarn install --ignore-scripts
RUN npm install -g tsx

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--experimental-specifier-resolution=node"

# Start server
CMD ["tsx", "./server/server.ts"] 