#!/usr/bin/env python3
"""
中文手写签名模拟器 - 演示脚本
这个脚本展示了如何使用 SignatureGenerator 生成各种风格的签名
"""

import os
import sys
from pathlib import Path

# 尝试导入依赖
try:
    from signature_generator import SignatureGenerator
except ImportError:
    print("请先安装依赖: pip install -r requirements.txt")
    sys.exit(1)


def find_system_font() -> str:
    """查找系统中可用的中文字体"""
    
    # macOS 常见中文字体路径
    macos_fonts = [
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc", 
        "/System/Library/Fonts/PingFang.ttc",
        "/Library/Fonts/Songti.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
        "/Library/Fonts/华文行楷.ttf",
        "/Library/Fonts/STXingkai.ttf",
    ]
    
    # Linux 常见中文字体路径
    linux_fonts = [
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    ]
    
    # Windows 常见中文字体路径
    windows_fonts = [
        "C:/Windows/Fonts/simkai.ttf",    # 楷体
        "C:/Windows/Fonts/STXINGKA.TTF",  # 华文行楷
        "C:/Windows/Fonts/simhei.ttf",    # 黑体
        "C:/Windows/Fonts/simsun.ttc",    # 宋体
        "C:/Windows/Fonts/msyh.ttc",      # 微软雅黑
    ]
    
    # 项目本地字体目录
    local_fonts = list(Path("./fonts").glob("*.ttf")) + list(Path("./fonts").glob("*.otf"))
    
    # 优先从本地字体中随机选择
    if local_fonts:
        import random
        chosen = random.choice(local_fonts)
        return str(chosen)
    
    # 否则查找系统字体
    all_candidates = macos_fonts + linux_fonts + windows_fonts
    
    for font_path in all_candidates:
        if os.path.exists(font_path):
            return font_path
    
    return None


def get_random_local_font() -> str:
    """从 fonts 目录随机选择一个字体"""
    import random
    fonts_dir = Path("./fonts")
    local_fonts = list(fonts_dir.glob("*.ttf")) + list(fonts_dir.glob("*.otf"))
    
    if not local_fonts:
        return None
    
    chosen = random.choice(local_fonts)
    return str(chosen)


def demo_basic(font_path: str, name: str = "李明"):
    """基础演示 - 生成单个签名"""
    print(f"\n{'='*50}")
    print("基础演示：生成单个签名")
    print('='*50)
    
    generator = SignatureGenerator(font_path, font_size=100)
    
    output_dir = Path("./output")
    output_dir.mkdir(exist_ok=True)
    
    # 生成签名
    signature = generator.generate(
        name=name,
        output_path=str(output_dir / f"{name}_basic.png"),
        style="natural",
        ink_color=(20, 20, 80),  # 深蓝墨水
    )
    
    print(f"签名尺寸: {signature.size}")


def demo_styles(font_path: str, name: str = "王芳"):
    """风格演示 - 展示不同签名风格"""
    print(f"\n{'='*50}")
    print("风格演示：不同签名风格")
    print('='*50)
    
    generator = SignatureGenerator(font_path, font_size=100)
    
    output_dir = Path("./output/styles")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    styles = ["natural", "formal", "casual"]
    
    for style in styles:
        generator.generate(
            name=name,
            output_path=str(output_dir / f"{name}_{style}.png"),
            style=style,
            ink_color=(10, 10, 60),
        )
        print(f"  - {style} 风格签名已生成")


def demo_colors(font_path: str, name: str = "张伟"):
    """颜色演示 - 不同墨水颜色"""
    print(f"\n{'='*50}")
    print("颜色演示：不同墨水颜色")
    print('='*50)
    
    generator = SignatureGenerator(font_path, font_size=100)
    
    output_dir = Path("./output/colors")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    colors = {
        "black": (10, 10, 10),
        "blue": (20, 20, 100),
        "navy": (0, 0, 80),
        "brown": (80, 40, 20),
        "red": (150, 20, 20),
    }
    
    for color_name, rgb in colors.items():
        generator.generate(
            name=name,
            output_path=str(output_dir / f"{name}_{color_name}.png"),
            style="natural",
            ink_color=rgb,
        )
        print(f"  - {color_name} 墨水签名已生成")


def demo_variations(font_path: str, name: str = "刘洋"):
    """变体演示 - 同一名字多个签名变体"""
    print(f"\n{'='*50}")
    print("变体演示：生成多个签名变体")
    print('='*50)
    
    generator = SignatureGenerator(font_path, font_size=100)
    
    output_dir = Path("./output/variations")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 生成5个不同的签名变体
    signatures = generator.generate_variations(
        name=name,
        count=5,
        output_dir=str(output_dir),
        style="natural",
        ink_color=(20, 30, 70),
    )
    
    print(f"已生成 {len(signatures)} 个签名变体")


def demo_transparent(font_path: str, name: str = "陈晨"):
    """透明背景演示 - 生成可叠加的签名"""
    print(f"\n{'='*50}")
    print("透明背景演示：生成PNG透明签名")
    print('='*50)
    
    generator = SignatureGenerator(font_path, font_size=100)
    
    output_dir = Path("./output")
    output_dir.mkdir(exist_ok=True)
    
    # 透明背景签名
    generator.generate(
        name=name,
        output_path=str(output_dir / f"{name}_transparent.png"),
        style="natural",
        ink_color=(0, 0, 80),
        background_color=(255, 255, 255, 0),  # 完全透明
        add_texture=False,
    )
    print("  - 透明背景签名已生成")


def interactive_mode(font_path: str):
    """交互模式 - 用户输入名字生成签名，每次随机选择字体"""
    print(f"\n{'='*50}")
    print("交互模式（每次随机选择字体）")
    print('='*50)
    
    output_dir = Path("./output")
    output_dir.mkdir(exist_ok=True)
    
    # 获取所有可用字体
    fonts_dir = Path("./fonts")
    local_fonts = list(fonts_dir.glob("*.ttf")) + list(fonts_dir.glob("*.otf"))
    
    if local_fonts:
        print(f"已加载 {len(local_fonts)} 个字体文件")
    
    while True:
        name = input("\n请输入姓名 (输入 'q' 退出): ").strip()
        
        if name.lower() == 'q':
            print("再见！")
            break
        
        if not name:
            print("姓名不能为空，请重新输入")
            continue
        
        # 每次随机选择字体
        if local_fonts:
            import random
            chosen_font = str(random.choice(local_fonts))
            print(f"\n随机选择字体: {Path(chosen_font).name}")
        else:
            chosen_font = font_path
            print(f"\n使用字体: {chosen_font}")
        
        generator = SignatureGenerator(chosen_font, font_size=100)
        
        print(f"为 '{name}' 生成签名...")
        
        # 生成三种风格
        for style in ["natural", "formal", "casual"]:
            output_path = output_dir / f"{name}_{style}.png"
            generator.generate(
                name=name,
                output_path=str(output_path),
                style=style,
                ink_color=(5, 5, 5),
                background_color=(255, 255, 255, 0),
                add_texture=False,
            )
            print(f"  ✓ {style} 风格 -> {output_path}")


def main():
    """主函数"""
    print("=" * 60)
    print("   中文手写签名模拟器 - 演示程序")
    print("=" * 60)
    
    # 查找可用字体
    print("\n正在查找系统中文字体...")
    font_path = find_system_font()
    
    if font_path is None:
        print("\n❌ 未找到可用的中文字体！")
        print("\n请执行以下操作之一:")
        print("1. 创建 ./fonts 目录并放入中文字体文件 (.ttf/.otf)")
        print("2. 下载免费手写字体:")
        print("   - 站酷快乐体: https://www.zcool.com.cn/special/zcoolfonts/")
        print("   - 沐瑶软笔手写体: https://www.maoken.com/freefonts")
        print("\n或直接指定字体路径运行:")
        print("   python demo.py --font /path/to/your/font.ttf")
        sys.exit(1)
    
    print(f"✓ 使用字体: {font_path}")
    
    # 检查命令行参数
    if len(sys.argv) > 1:
        if sys.argv[1] == "--interactive" or sys.argv[1] == "-i":
            interactive_mode(font_path)
            return
        elif sys.argv[1] == "--font" and len(sys.argv) > 2:
            font_path = sys.argv[2]
            if not os.path.exists(font_path):
                print(f"❌ 字体文件不存在: {font_path}")
                sys.exit(1)
    
    # 运行所有演示
    try:
        demo_basic(font_path)
        demo_styles(font_path)
        demo_colors(font_path)
        demo_variations(font_path)
        demo_transparent(font_path)
        
        print(f"\n{'='*50}")
        print("✓ 所有演示完成！")
        print(f"  签名文件保存在: ./output/")
        print('='*50)
        
        print("\n提示: 运行交互模式生成自定义签名:")
        print("  python demo.py --interactive")
        
    except Exception as e:
        print(f"\n❌ 演示运行出错: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

