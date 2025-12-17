# 中文手写签名模拟器

一个基于字体变形的中文手写签名生成器，不使用深度学习，通过程序化的方式模拟手写签名效果。

## 特性

- 🖊️ **多种签名风格**: 自然(natural)、正式(formal)、随意(casual)
- 🎨 **可自定义墨水颜色**: 支持黑色、蓝色、棕色等多种颜色
- 🔄 **签名变体生成**: 同一个名字可生成多个不同的签名变体
- 🖼️ **透明背景支持**: 生成可叠加到其他文档的 PNG 签名
- 📝 **多种字体支持**: 支持 TTF/OTF 格式的中文字体

## 签名效果模拟技术

| 效果 | 描述 |
|------|------|
| 随机倾斜 | 每个字的旋转角度略有不同 |
| 大小变化 | 字符大小随机波动 |
| 位置抖动 | 字符上下左右轻微偏移 |
| 基线波动 | 整体书写线呈波浪形 |
| 斜体效果 | 整体向右或向左倾斜 |
| 笔画粗细 | 模拟笔压变化 |
| 边缘粗糙 | 模拟纸张吸墨效果 |
| 波形扭曲 | 模拟手写的自然弯曲 |

## 安装

```bash
# 克隆项目
cd handwriting-simulator

# 安装依赖
pip install -r requirements.txt
```

## 字体准备

项目需要中文字体文件才能运行。推荐使用手写风格的字体：

### 免费字体推荐

1. **站酷快乐体** - [下载](https://www.zcool.com.cn/special/zcoolfonts/)
2. **沐瑶软笔手写体** - [猫啃网下载](https://www.maoken.com/freefonts)
3. **杨任东竹石体** - [猫啃网下载](https://www.maoken.com/freefonts)
4. **霞鹜文楷** - [GitHub](https://github.com/lxgw/LxgwWenKai)

下载后将字体文件放入 `./fonts/` 目录，或使用系统已安装的字体。

## 快速开始

### 运行演示

```bash
python demo.py
```

程序会自动查找系统中文字体并生成示例签名。

### 交互模式

```bash
python demo.py --interactive
```

可以交互式输入名字生成签名。

### 指定字体

```bash
python demo.py --font /path/to/your/font.ttf
```

### 代码调用

```python
from signature_generator import SignatureGenerator

# 创建生成器
generator = SignatureGenerator(
    font_path="./fonts/handwriting.ttf",
    font_size=100
)

# 生成单个签名
signature = generator.generate(
    name="张三",
    output_path="./张三_signature.png",
    style="natural",           # natural/formal/casual
    ink_color=(20, 20, 80),    # RGB 深蓝色
)

# 生成多个变体
signatures = generator.generate_variations(
    name="李四",
    count=5,
    output_dir="./signatures/",
    style="casual"
)
```

## API 参考

### SignatureGenerator

#### 初始化参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| font_path | str | 必填 | 字体文件路径 |
| font_size | int | 80 | 基础字体大小 |
| seed | int | None | 随机种子（用于复现） |

#### generate() 方法

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| name | str | 必填 | 要签名的中文名字 |
| output_path | str | None | 输出文件路径 |
| style | str | "natural" | 风格: natural/formal/casual |
| ink_color | tuple | (20,20,80) | 墨水颜色 RGB |
| background_color | tuple | (255,255,255,0) | 背景色 RGBA |
| add_texture | bool | True | 是否添加纸张纹理 |

#### generate_variations() 方法

生成多个签名变体，参数同 `generate()`，额外参数：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| count | int | 5 | 生成数量 |
| output_dir | str | "./signatures" | 输出目录 |

## 签名风格说明

### natural (自然)
- 中等程度的随机变形
- 适合日常签名场景
- 自然倾斜，略有抖动

### formal (正式)
- 较小的变形幅度
- 适合正式文档签名
- 工整但不失手写感

### casual (随意)
- 较大的随机变形
- 适合非正式场合
- 随性、个性化

## 输出示例

运行 `demo.py` 后，将在 `./output/` 目录生成：

```
output/
├── 李明_basic.png          # 基础签名
├── 陈晨_transparent.png    # 透明背景
├── styles/
│   ├── 王芳_natural.png    # 自然风格
│   ├── 王芳_formal.png     # 正式风格
│   └── 王芳_casual.png     # 随意风格
├── colors/
│   ├── 张伟_black.png      # 黑色墨水
│   ├── 张伟_blue.png       # 蓝色墨水
│   └── ...
└── variations/
    ├── 刘洋_signature_1.png
    ├── 刘洋_signature_2.png
    └── ...
```

## 技术原理

本项目采用纯程序化方法模拟手写效果：

1. **字符渲染**: 使用 Pillow 加载字体并渲染每个汉字
2. **个体变形**: 对每个字符应用随机旋转、缩放
3. **组合排列**: 按照波动基线组合字符，添加位置抖动
4. **整体变形**: 应用仿射变换（倾斜）和波形扭曲
5. **后处理**: 边缘粗糙化、模拟墨水晕染效果

## 注意事项

- 生成的签名仅供学习和测试用途
- 请勿将生成的签名用于任何欺诈或非法目的
- 使用字体时请注意字体的授权协议

## License

MIT License

