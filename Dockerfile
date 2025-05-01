FROM node:20

WORKDIR /app

# Install yarn
RUN npm install -g yarn

# Copy package files
COPY package*.json ./

# Install dependencies
RUN yarn install

# Copy source code
COPY . .

# Build the library
RUN yarn build

# Expose port
EXPOSE 3000

# Start server
CMD ["yarn", "server"] 