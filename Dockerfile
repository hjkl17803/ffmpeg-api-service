# 使用包含 FFmpeg 的基礎映像
FROM jrottenberg/ffmpeg:4.4-ubuntu

# 安裝 Node.js 18
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 設定工作目錄
WORKDIR /app

# 複製 package 文件
COPY package*.json ./

# 安裝依賴
RUN npm ci --only=production

# 複製應用代碼
COPY server.js ./

# 創建並設定臨時目錄權限
RUN mkdir -p /tmp && chmod 777 /tmp

# 暴露端口
EXPOSE 3000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 啟動應用
CMD ["node", "server.js"]
```

點擊 `Commit changes`

---

#### **文件 4: `.dockerignore`**

創建新文件 `.dockerignore`
```
node_modules
npm-debug.log
.git
.gitignore
README.md
.env
.DS_Store
*.log
coverage
.vscode
.idea
