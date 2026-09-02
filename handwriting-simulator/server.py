#!/usr/bin/env python3
"""
中文手写签名生成器 - HTTP API 服务
端口: 3333
"""

import base64
import io
import os
import random
from pathlib import Path

from flask import Flask, request, jsonify

from signature_generator import SignatureGenerator

app = Flask(__name__)

# 获取所有可用字体
FONTS_DIR = Path("./fonts")
AVAILABLE_FONTS = list(FONTS_DIR.glob("*.ttf")) + list(FONTS_DIR.glob("*.otf"))

if not AVAILABLE_FONTS:
    # 如果没有本地字体，使用系统字体
    import sys
    if sys.platform == "darwin":
        AVAILABLE_FONTS = [Path("/System/Library/Fonts/Supplemental/Songti.ttc")]
    else:
        print("警告: 没有找到可用字体，请在 fonts/ 目录放入 TTF 字体文件")


def get_random_font():
    """随机选择一个字体"""
    if AVAILABLE_FONTS:
        return str(random.choice(AVAILABLE_FONTS))
    return None


def generate_signature_base64(
    name: str,
    style: str = "natural",
    font_path: str = None,
    ink_color: tuple = (5, 5, 5),
    stroke_scale: float = 1.0
) -> str:
    """
    生成签名并返回 base64 编码
    
    Args:
        name: 签名名字
        style: 风格 (natural/formal/casual)
        font_path: 字体路径，None 则随机选择
        ink_color: 墨水颜色 RGB
        stroke_scale: 笔画粗细 (0.6~1.1)
        
    Returns:
        base64 编码的 PNG 图片
    """
    if font_path is None:
        font_path = get_random_font()
    
    if font_path is None:
        raise ValueError("没有可用的字体文件")
    
    generator = SignatureGenerator(font_path, font_size=100)
    
    # 生成签名图片
    img = generator.generate(
        name=name,
        style=style,
        ink_color=ink_color,
        background_color=(255, 255, 255, 0),  # 透明背景
        add_texture=False,
        stroke_scale=stroke_scale
    )
    
    # 转换为 base64
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    
    base64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return base64_str


@app.route("/", methods=["GET"])
def index():
    """首页 - API 说明"""
    return jsonify({
        "service": "中文手写签名生成器",
        "version": "1.0",
        "endpoints": {
            "POST /generate": {
                "description": "生成签名图片",
                "params": {
                    "name": "(必填) 签名名字",
                    "style": "(可选) 风格: natural/formal/casual，默认 natural",
                    "stroke_scale": "(可选) 笔画粗细: 0.6~1.1，默认 1.0",
                    "ink_color": "(可选) 墨水颜色 [r,g,b]，默认 [5,5,5]"
                },
                "response": {
                    "success": "true/false",
                    "image": "base64 编码的 PNG 图片",
                    "font": "使用的字体"
                }
            },
            "GET /fonts": "列出可用字体"
        },
        "example": 'curl -X POST http://localhost:3333/generate -H "Content-Type: application/json" -d \'{"name": "张三"}\''
    })


@app.route("/generate", methods=["POST"])
def generate():
    """生成签名 API"""
    try:
        data = request.get_json() or {}
        
        # 获取参数
        name = data.get("name")
        if not name:
            return jsonify({"success": False, "error": "缺少 name 参数"}), 400
        
        style = data.get("style", "natural")
        if style not in ["natural", "formal", "casual"]:
            style = "natural"
        
        stroke_scale = float(data.get("stroke_scale", 1.0))
        stroke_scale = max(0.5, min(1.1, stroke_scale))  # 限制范围
        
        ink_color = data.get("ink_color", [5, 5, 5])
        if isinstance(ink_color, list) and len(ink_color) == 3:
            ink_color = tuple(ink_color)
        else:
            ink_color = (5, 5, 5)
        
        # 随机选择字体
        font_path = get_random_font()
        font_name = Path(font_path).name if font_path else "unknown"
        
        # 生成签名
        base64_img = generate_signature_base64(
            name=name,
            style=style,
            font_path=font_path,
            ink_color=ink_color,
            stroke_scale=stroke_scale
        )
        
        return jsonify({
            "success": True,
            "name": name,
            "style": style,
            "font": font_name,
            "stroke_scale": stroke_scale,
            "image": base64_img
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/fonts", methods=["GET"])
def list_fonts():
    """列出可用字体"""
    fonts = [f.name for f in AVAILABLE_FONTS]
    return jsonify({
        "count": len(fonts),
        "fonts": fonts
    })


if __name__ == "__main__":
    # 监听地址/端口可由环境变量覆盖（生产环境由 systemd 设为 127.0.0.1:3333，仅本机可访问）
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "3333"))
    print("=" * 50)
    print("中文手写签名生成器 API 服务")
    print("=" * 50)
    print(f"可用字体: {len(AVAILABLE_FONTS)} 个")
    for f in AVAILABLE_FONTS:
        print(f"  - {f.name}")
    print()
    print(f"API 地址: http://{host}:{port}")
    print("生成签名: POST /generate")
    print("=" * 50)
    
    app.run(host=host, port=port, debug=False)

