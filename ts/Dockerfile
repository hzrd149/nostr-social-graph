FROM node:20

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.28.2

# Copy workspace manifests first for better Docker layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ts/package.json ts/package.json

# Install dependencies (skip prepare scripts that try to build)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY . .

WORKDIR /app/ts

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--experimental-specifier-resolution=node"

# Start server
CMD ["pnpm", "server"]
