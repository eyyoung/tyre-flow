FROM python:3.12-slim

WORKDIR /app

# 安装系统依赖（用于 Pillow 图像处理）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件并安装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 暴露端口
EXPOSE 3333

# 启动服务
CMD ["python", "server.py"]
