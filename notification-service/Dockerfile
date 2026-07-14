# Image cho IOT Notification Service (Node.js/Express).
# Node đơn giản, không cần multi-stage như .NET của Phong.
FROM node:20-alpine

WORKDIR /app

# Cài dependency trước (tận dụng cache layer) — chỉ cần package*.json.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy phần còn lại của source (node_modules/.env/key đã bị .dockerignore loại).
COPY . .

ENV NODE_ENV=production
# App nghe cổng 3001 (đọc từ env PORT, mặc định 3001).
EXPOSE 3001

CMD ["npm", "start"]
