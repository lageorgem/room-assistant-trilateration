# Base image for Home Assistant add-ons
ARG BUILD_FROM
FROM $BUILD_FROM

# Install Node.js and npm
RUN apk add --no-cache nodejs npm

# Install required Node.js packages
RUN npm install axios numeric

# Copy the add-on's main script into the container
COPY run.js /app/run.js

# Set permissions and entry point
RUN chmod a+x /app/run.js
ENTRYPOINT ["/app/run.js"]

# Define the working directory
WORKDIR /app

# Default command to run the script
CMD ["node", "/app/run.js"]
