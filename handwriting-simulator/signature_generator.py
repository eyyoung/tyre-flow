"""
中文手写签名模拟器
基于字体变形的非深度学习方案
"""

import math
import random
from pathlib import Path
from typing import Optional, Tuple, List

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
from scipy.ndimage import map_coordinates


class SignatureGenerator:
    """中文手写签名生成器"""
    
    def __init__(
        self,
        font_path: str,
        font_size: int = 80,
        seed: Optional[int] = None
    ):
        """
        初始化签名生成器
        
        Args:
            font_path: 字体文件路径 (.ttf 或 .otf)
            font_size: 基础字体大小
            seed: 随机种子，用于复现签名效果
        """
        # 转换为绝对路径，避免相对路径在运行中失效
        self.font_path = str(Path(font_path).resolve())
        self.base_font_size = font_size
        
        if seed is not None:
            random.seed(seed)
            np.random.seed(seed)
        
        # 验证字体文件存在
        if not Path(self.font_path).exists():
            raise FileNotFoundError(f"字体文件不存在: {self.font_path}")
        
        # 验证字体是否可用
        try:
            self.font = ImageFont.truetype(self.font_path, font_size)
        except OSError as e:
            raise ValueError(
                f"无法加载字体文件: {self.font_path}\n"
                f"可能原因:\n"
                f"  1. 字体文件损坏或格式不支持\n"
                f"  2. 字体文件是 .ttc 集合文件，需要指定 index 参数\n"
                f"  3. 字体缺少必要的字形表\n"
                f"原始错误: {e}"
            ) from e
    
    def check_char_support(self, char: str) -> bool:
        """
        检查字体是否支持某个字符
        
        Args:
            char: 要检查的字符
            
        Returns:
            是否支持该字符
        """
        # 渲染字符并检查是否有实际内容
        img = Image.new("L", (100, 100), 255)
        draw = ImageDraw.Draw(img)
        draw.text((10, 10), char, font=self.font, fill=0)
        
        # 检查是否有非白色像素
        arr = np.array(img)
        return np.any(arr < 250)
    
    def check_name_support(self, name: str) -> Tuple[bool, List[str]]:
        """
        检查字体是否支持名字中的所有字符
        
        Args:
            name: 要检查的名字
            
        Returns:
            (是否全部支持, 不支持的字符列表)
        """
        unsupported = []
        for char in name:
            if not self.check_char_support(char):
                unsupported.append(char)
        return len(unsupported) == 0, unsupported
    
    def generate(
        self,
        name: str,
        output_path: Optional[str] = None,
        style: str = "natural",
        ink_color: Tuple[int, int, int] = (20, 20, 80),
        background_color: Tuple[int, int, int, int] = (255, 255, 255, 0),
        add_texture: bool = True,
        stroke_scale: float = 1.0
    ) -> Image.Image:
        """
        生成手写签名
        
        Args:
            name: 要签名的中文名字
            output_path: 输出文件路径（可选）
            style: 签名风格 - "natural"(自然), "formal"(正式), "casual"(随意)
            ink_color: 墨水颜色 RGB
            background_color: 背景颜色 RGBA
            add_texture: 是否添加纸张纹理
            stroke_scale: 笔画粗细缩放比例 (0.5=变细一半, 1.0=原始, 2.0=变粗一倍)
            
        Returns:
            生成的签名图像
        """
        # 根据风格设置变形参数
        params = self._get_style_params(style)
        
        # 1. 渲染每个字符并应用个体变形
        char_images = []
        for i, char in enumerate(name):
            char_img = self._render_char(char, ink_color, params, i)
            char_images.append(char_img)
        
        # 2. 组合字符图像
        combined = self._combine_chars(char_images, params)
        
        # 3. 调整笔画粗细
        if stroke_scale != 1.0:
            combined = self._adjust_stroke_width(combined, stroke_scale)
        
        # 4. 应用整体变形
        warped = self._apply_global_warp(combined, params)
        
        # 5. 添加手写效果
        final = self._add_handwriting_effects(warped, ink_color, params)
        
        # 6. 添加背景
        result = self._add_background(final, background_color, add_texture)
        
        # 保存结果
        if output_path:
            result.save(output_path, "PNG")
            print(f"签名已保存至: {output_path}")
        
        return result
    
    def _get_style_params(self, style: str) -> dict:
        """获取不同风格的参数设置"""
        params = {
            "natural": {
                "rotation_range": (-5, 5),       # 单字旋转范围（度）
                "size_variation": 0.08,          # 大小变化幅度
                "position_jitter": 3,            # 位置抖动像素
                "baseline_wave": 0.012,          # 基线波动幅度
                "slant_angle": random.uniform(-5, 8),  # 整体倾斜
                "char_spacing": -0.12,           # 字符间距（轻微紧凑）
                "stroke_variation": True,        # 笔画粗细变化
                "edge_roughness": 0.5,           # 边缘粗糙度
            },
            "formal": {
                "rotation_range": (-2, 2),
                "size_variation": 0.03,
                "position_jitter": 1,
                "baseline_wave": 0.005,
                "slant_angle": random.uniform(2, 5),
                "char_spacing": -0.08,           # 正式风格间距稍大
                "stroke_variation": False,
                "edge_roughness": 0.15,
            },
            "casual": {
                "rotation_range": (-8, 8),
                "size_variation": 0.12,
                "position_jitter": 5,
                "baseline_wave": 0.02,
                "slant_angle": random.uniform(-8, 12),
                "char_spacing": -0.18,           # 随意风格稍紧凑
                "stroke_variation": True,
                "edge_roughness": 0.8,
            }
        }
        return params.get(style, params["natural"])
    
    def _render_char(
        self,
        char: str,
        ink_color: Tuple[int, int, int],
        params: dict,
        char_index: int
    ) -> Image.Image:
        """渲染单个字符并应用变形"""
        
        # 随机调整字体大小
        size_factor = 1.0 + random.uniform(-params["size_variation"], params["size_variation"])
        current_size = int(self.base_font_size * size_factor)
        font = ImageFont.truetype(self.font_path, current_size)
        
        # 获取字符边界
        bbox = font.getbbox(char)
        char_width = bbox[2] - bbox[0]
        char_height = bbox[3] - bbox[1]
        
        # 创建画布（最小padding用于旋转）
        padding = 3
        canvas_size = (char_width + padding * 2, char_height + padding * 2)
        img = Image.new("RGBA", canvas_size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(img)
        
        # 绘制字符
        x = padding - bbox[0]
        y = padding - bbox[1]
        draw.text((x, y), char, font=font, fill=(*ink_color, 255))
        
        # 应用单字旋转（不扩展画布，保持紧凑）
        rotation = random.uniform(*params["rotation_range"])
        img = img.rotate(rotation, resample=Image.BICUBIC, expand=False, fillcolor=(255, 255, 255, 0))
        
        # 裁剪到实际内容
        img = self._crop_char_to_content(img)
        
        # 应用笔画粗细变化
        if params["stroke_variation"]:
            img = self._vary_stroke_thickness(img)
        
        return img
    
    def _crop_char_to_content(self, img: Image.Image) -> Image.Image:
        """裁剪单个字符到内容边界"""
        arr = np.array(img)
        if arr.shape[2] < 4:
            return img
        alpha = arr[:, :, 3]
        
        rows = np.any(alpha > 10, axis=1)
        cols = np.any(alpha > 10, axis=0)
        
        if not rows.any() or not cols.any():
            return img
        
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        
        # 添加最小边距
        margin = 3
        rmin = max(0, rmin - margin)
        rmax = min(arr.shape[0], rmax + margin + 1)
        cmin = max(0, cmin - margin)
        cmax = min(arr.shape[1], cmax + margin + 1)
        
        return img.crop((cmin, rmin, cmax, rmax))
    
    def _vary_stroke_thickness(self, img: Image.Image) -> Image.Image:
        """模拟笔画粗细变化"""
        # 转换为numpy数组
        arr = np.array(img)
        alpha = arr[:, :, 3].astype(float) / 255.0
        
        # 随机选择膨胀或腐蚀
        if random.random() > 0.5:
            # 轻微膨胀 - 笔画变粗
            from scipy.ndimage import maximum_filter
            kernel_size = random.choice([2, 3])
            alpha = maximum_filter(alpha, size=kernel_size)
            alpha = np.clip(alpha * 0.9, 0, 1)  # 防止过度膨胀
        else:
            # 保持原样或轻微腐蚀
            pass
        
        arr[:, :, 3] = (alpha * 255).astype(np.uint8)
        return Image.fromarray(arr)
    
    def _adjust_stroke_width(self, img: Image.Image, scale: float) -> Image.Image:
        """
        调整笔画粗细
        
        Args:
            img: 输入图像
            scale: 缩放比例
                   < 1.0: 笔画变细 (如 0.7 = 变细)
                   = 1.0: 保持原样
                   > 1.0: 笔画变粗 (最大1.1 = 变粗10%)
        
        Returns:
            调整后的图像
        """
        from scipy.ndimage import grey_dilation, grey_erosion
        
        # 限制变粗最大为1.1倍
        if scale > 1.1:
            scale = 1.1
        
        arr = np.array(img)
        alpha = arr[:, :, 3].astype(float) / 255.0
        
        if scale > 1.0:
            # 笔画变粗 - 轻微膨胀
            # scale 1.0~1.1 对应轻微的膨胀
            kernel_size = 2
            alpha = grey_dilation(alpha, size=kernel_size)
            
            # 控制膨胀程度：scale越接近1.0，保留越多原始
            blend_factor = (scale - 1.0) / 0.1  # 0~1
            original_alpha = arr[:, :, 3].astype(float) / 255.0
            alpha = original_alpha * (1 - blend_factor * 0.5) + alpha * (blend_factor * 0.5 + 0.5)
            alpha = np.clip(alpha, 0, 1)
            
        elif scale < 1.0:
            # 笔画变细 - 使用腐蚀
            iterations = max(1, int((1.0 - scale) * 5))
            kernel_size = 2
            
            for _ in range(iterations):
                alpha = grey_erosion(alpha, size=kernel_size)
            
            # 增强残留的像素
            alpha = np.clip(alpha * (1.5 - scale * 0.5), 0, 1)
        
        arr[:, :, 3] = (alpha * 255).astype(np.uint8)
        return Image.fromarray(arr)
    
    def _combine_chars(
        self,
        char_images: List[Image.Image],
        params: dict
    ) -> Image.Image:
        """组合所有字符图像"""
        if not char_images:
            return Image.new("RGBA", (100, 100), (255, 255, 255, 0))
        
        # 计算总宽度和最大高度
        # 间距因子：负值表示字符重叠
        spacing_factor = 1.0 + params["char_spacing"]
        max_height = 0
        
        for img in char_images:
            max_height = max(max_height, img.height)
        
        # 计算总宽度（考虑重叠）
        total_width = 0
        for i, img in enumerate(char_images):
            if i == 0:
                total_width += img.width
            else:
                total_width += int(img.width * spacing_factor)
        
        # 创建组合画布（无边距）
        padding = 0
        canvas = Image.new(
            "RGBA",
            (total_width, max_height),
            (255, 255, 255, 0)
        )
        
        # 放置每个字符
        x_offset = padding
        for i, img in enumerate(char_images):
            # 计算基线波动
            wave_offset = int(
                math.sin(i * 1.5) * max_height * params["baseline_wave"]
            )
            
            # 添加随机位置抖动
            jitter_x = random.randint(-params["position_jitter"] // 2, params["position_jitter"] // 2)
            jitter_y = random.randint(-params["position_jitter"], params["position_jitter"])
            
            y_offset = padding + (max_height - img.height) // 2 + wave_offset + jitter_y
            
            # 粘贴字符
            canvas.paste(img, (x_offset + jitter_x, y_offset), img)
            
            # 第一个字符后开始应用间距因子
            if i == 0:
                x_offset += int(img.width * spacing_factor)
            else:
                x_offset += int(img.width * spacing_factor)
        
        return canvas
    
    def _apply_global_warp(self, img: Image.Image, params: dict) -> Image.Image:
        """应用整体变形效果"""
        
        # 1. 整体倾斜（斜体效果）
        slant = params["slant_angle"]
        if abs(slant) > 0.5:
            img = self._apply_shear(img, slant)
        
        # 2. 应用波形扭曲
        img = self._apply_wave_distortion(img, params["baseline_wave"])
        
        return img
    
    def _apply_shear(self, img: Image.Image, angle: float) -> Image.Image:
        """应用剪切变换（倾斜效果）"""
        # 计算剪切系数
        shear = math.tan(math.radians(angle))
        
        # 计算新尺寸
        width, height = img.size
        new_width = int(width + abs(shear) * height)
        
        # 创建仿射变换矩阵
        # [1, shear, offset_x]
        # [0, 1, 0]
        if shear > 0:
            offset_x = 0
        else:
            offset_x = -shear * height
        
        matrix = (1, shear, -offset_x, 0, 1, 0)
        
        result = img.transform(
            (new_width, height),
            Image.AFFINE,
            matrix,
            resample=Image.BICUBIC
        )
        
        return result
    
    def _apply_wave_distortion(self, img: Image.Image, amplitude: float) -> Image.Image:
        """应用波形扭曲"""
        arr = np.array(img)
        height, width = arr.shape[:2]
        
        # 创建扭曲映射
        x, y = np.meshgrid(np.arange(width), np.arange(height))
        
        # 水平波动
        wave_x = amplitude * height * np.sin(2 * np.pi * y / height * 1.5)
        # 垂直波动
        wave_y = amplitude * width * 0.3 * np.sin(2 * np.pi * x / width * 2)
        
        new_x = x + wave_x
        new_y = y + wave_y
        
        # 应用扭曲到每个通道
        result = np.zeros_like(arr)
        for i in range(arr.shape[2]):
            result[:, :, i] = map_coordinates(
                arr[:, :, i],
                [new_y, new_x],
                order=1,
                mode='constant',
                cval=0
            )
        
        return Image.fromarray(result.astype(np.uint8))
    
    def _add_handwriting_effects(
        self,
        img: Image.Image,
        ink_color: Tuple[int, int, int],
        params: dict
    ) -> Image.Image:
        """添加手写效果"""
        
        # 1. 边缘粗糙化
        if params["edge_roughness"] > 0:
            img = self._roughen_edges(img, params["edge_roughness"])
        
        # 2. 添加轻微模糊（模拟墨水晕染）
        img = img.filter(ImageFilter.GaussianBlur(radius=0.5))
        
        # 3. 增强对比度
        img = self._adjust_ink_density(img, ink_color)
        
        return img
    
    def _roughen_edges(self, img: Image.Image, roughness: float) -> Image.Image:
        """粗糙化边缘，模拟纸张吸墨效果"""
        arr = np.array(img)
        alpha = arr[:, :, 3].astype(float)
        
        # 添加噪声到alpha通道边缘
        height, width = alpha.shape
        noise = np.random.normal(0, roughness * 10, (height, width))
        
        # 只在边缘区域添加噪声
        from scipy.ndimage import sobel
        edges = np.abs(sobel(alpha, axis=0)) + np.abs(sobel(alpha, axis=1))
        edges = edges / edges.max() if edges.max() > 0 else edges
        
        alpha = alpha + noise * edges
        alpha = np.clip(alpha, 0, 255)
        
        arr[:, :, 3] = alpha.astype(np.uint8)
        return Image.fromarray(arr)
    
    def _adjust_ink_density(
        self,
        img: Image.Image,
        ink_color: Tuple[int, int, int]
    ) -> Image.Image:
        """调整墨水浓度，保持原色"""
        arr = np.array(img).astype(float)
        alpha = arr[:, :, 3] / 255.0
        
        # 保持指定的墨水颜色，只在边缘略微变浅
        for i in range(3):
            # 核心区域保持原色，边缘轻微淡化
            arr[:, :, i] = ink_color[i] + (255 - ink_color[i]) * (1 - alpha ** 0.5) * 0.3
        
        # 增强alpha使颜色更实
        arr[:, :, 3] = np.clip(arr[:, :, 3] * 1.2, 0, 255)
        
        return Image.fromarray(arr.astype(np.uint8))
    
    def _add_background(
        self,
        img: Image.Image,
        bg_color: Tuple[int, int, int, int],
        add_texture: bool
    ) -> Image.Image:
        """添加背景"""
        
        # 裁剪多余空白
        img = self._crop_to_content(img)
        
        # 不添加额外边距
        padding = 0
        new_size = (img.width, img.height)
        
        # 创建背景
        if bg_color[3] == 0:
            # 透明背景
            result = Image.new("RGBA", new_size, (255, 255, 255, 0))
        else:
            result = Image.new("RGBA", new_size, bg_color)
            
            if add_texture:
                result = self._add_paper_texture(result)
        
        # 粘贴签名
        result.paste(img, (padding, padding), img)
        
        return result
    
    def _crop_to_content(self, img: Image.Image) -> Image.Image:
        """裁剪到内容边界"""
        arr = np.array(img)
        alpha = arr[:, :, 3]
        
        # 找到非透明区域
        rows = np.any(alpha > 10, axis=1)
        cols = np.any(alpha > 10, axis=0)
        
        if not rows.any() or not cols.any():
            return img
        
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        
        # 无边距，紧贴内容
        return img.crop((cmin, rmin, cmax + 1, rmax + 1))
    
    def _add_paper_texture(self, img: Image.Image) -> Image.Image:
        """添加纸张纹理"""
        arr = np.array(img).astype(float)
        height, width = arr.shape[:2]
        
        # 生成纸张纹理噪声
        noise = np.random.normal(0, 3, (height, width))
        
        # 应用到RGB通道
        for i in range(3):
            arr[:, :, i] = np.clip(arr[:, :, i] + noise, 0, 255)
        
        return Image.fromarray(arr.astype(np.uint8))
    
    def generate_variations(
        self,
        name: str,
        count: int = 5,
        output_dir: str = "./signatures",
        **kwargs
    ) -> List[Image.Image]:
        """
        生成多个签名变体
        
        Args:
            name: 要签名的名字
            count: 生成数量
            output_dir: 输出目录
            **kwargs: 传递给 generate() 的其他参数
            
        Returns:
            生成的签名图像列表
        """
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        
        signatures = []
        for i in range(count):
            # 每次使用不同的随机种子
            random.seed(None)
            np.random.seed(None)
            
            output_path = Path(output_dir) / f"{name}_signature_{i+1}.png"
            sig = self.generate(name, str(output_path), **kwargs)
            signatures.append(sig)
            print(f"生成签名 {i+1}/{count}")
        
        return signatures


def main():
    """示例用法"""
    import sys
    
    # 检查命令行参数
    if len(sys.argv) < 3:
        print("用法: python signature_generator.py <字体文件路径> <姓名> [输出路径]")
        print("示例: python signature_generator.py ./fonts/handwriting.ttf 张三 ./output.png")
        print("\n可选字体推荐（需自行下载）:")
        print("  - 站酷快乐体 (免费)")
        print("  - 沐瑶软笔手写体 (免费)")
        print("  - 杨任东竹石体 (免费)")
        sys.exit(1)
    
    font_path = sys.argv[1]
    name = sys.argv[2]
    output_path = sys.argv[3] if len(sys.argv) > 3 else f"{name}_signature.png"
    
    try:
        # 创建生成器
        generator = SignatureGenerator(font_path, font_size=100)
        
        # 生成签名
        print(f"正在为 '{name}' 生成签名...")
        generator.generate(
            name=name,
            output_path=output_path,
            style="natural",
            ink_color=(20, 20, 80),  # 深蓝色墨水
        )
        
        # 也可以生成多个变体
        # generator.generate_variations(name, count=5, output_dir="./signatures")
        
    except FileNotFoundError as e:
        print(f"错误: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"生成签名时出错: {e}")
        raise


if __name__ == "__main__":
    main()

