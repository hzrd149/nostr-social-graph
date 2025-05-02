FROM node:20

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN yarn install
RUN npm install -g tsx

# Copy source code
COPY . .

# Build the library
RUN yarn build

# Create data directory
RUN mkdir -p data

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--experimental-specifier-resolution=node"

# Start server
CMD ["tsx", "./server/server.ts"] 