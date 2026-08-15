# dsh-plugin-background-image

一个用于 DeepSeek Harness（DSH）的背景图片插件：为界面设置网络图片、本地图片或预设渐变背景，并支持图片不透明度、显示范围、毛玻璃模糊与分区不透明度调节，营造更沉浸的界面效果。

## 功能特性

- 网络图片（`http(s)://`）、本地图片（绝对路径）与 `data:image/` 数据地址
- 预设渐变色板（极光 / 晴空 / 樱花 / 落日 / 薄荷 / 深海）
- 图片不透明度调节
- 显示范围：**沉浸式全屏** / **仅对话区域**
- **毛玻璃模糊** + 颜色饱和度（作用于输入卡片等玻璃浮层）
- **分区不透明度**：侧边栏、输入区可独立调节
- 设置持久化到 `settings.yaml`，刷新页面或重启 DSH 后自动恢复

## 效果演示

![DSH 背景图片插件演示](./demo/dsh-plugin-background-image-1.png)

## 安装

### 从本地目录安装

```bash
npx @deepseek-ai/dsh plugin --profile <profile名> add \
  dsh-plugin-background-image@file:/路径/到/background-image-plugin
```

例如：

```bash
npx @deepseek-ai/dsh plugin --profile web add \
  dsh-plugin-background-image@file:/Users/your-name/projects/background-image-plugin
```

### 从 npm 安装

```bash
npx @deepseek-ai/dsh plugin --profile <profile名> add dsh-plugin-background-image
```

安装完成后，使用同一个 profile 启动 DSH 即可。

## 使用方法

1. 打开 DSH。
2. 进入 **设置 → 插件 → 插件配置**。
3. 找到 **背景图片设置**。
4. 开启背景功能，然后选择网络图片、本地图片或预设渐变。本地图片点「选择本地图片」会弹出系统原生文件框，选中的绝对路径被记录（文件留在原处，不复制、不搬移）。
5. 根据需要调整图片不透明度、显示范围，以及**毛玻璃**（背景模糊强度、玻璃颜色饱和度，作用于输入卡片）与**分区不透明度**（侧边栏、输入区）。数值越低越透明、越沉浸；侧边栏为透明玻璃（仅「沉浸式全屏」下生效），输入区在两种模式下均生效。

## 配置存储

背景开关、显示范围、图片不透明度、毛玻璃与分区不透明度由 DSH 设置系统统一持久化到配置目录（默认 `~/.dsh/settings.yaml`），形如：

```yaml
background-image:
  enabled: true
  mode: fullscreen
  opacity: 0.9
  image: https://example.com/background.webp
  blur: 12             # 毛玻璃模糊强度（px，作用于输入卡片，0 关闭）
  saturation: 1.4      # 玻璃颜色饱和度（1 原样，>1 更鲜艳）
  sidebarOpacity: 0.5  # 侧边栏不透明度（仅全屏模式生效）
  composerOpacity: 0.72 # 输入区不透明度
```

- 刷新页面或重启 DSH 后自动恢复；
- 本地图片**直接记录绝对路径，不复制、不搬移**，文件留在原处：

```yaml
background-image:
  enabled: true
  mode: fullscreen
  opacity: 0.9
  image: /Users/you/Pictures/background.png
  blur: 0
  saturation: 1
  sidebarOpacity: 0.5
  composerOpacity: 0.72
```

> 浏览器因安全策略不能直接加载 `file://` 资源，因此插件在 Host 注册了一个只读文件服务路由（`GET /plugins/background-image/file?path=<绝对路径>`），把被配置引用的本地图片以同源 http 方式提供给页面。该路由仅接受本机回环来源，且只允许读取 settings.yaml 当前 `image` 字段引用的那个路径（“引用即授权”，与官方 `session.attachment` 的授权模型一致）。若图片文件被移动或删除，背景会失效，需要重新设置路径。

## 依赖

### 运行时依赖

- `@deepseek-ai/schemastery`：主机端设置 schema 定义与校验。
- `react`（peer，可选）：客户端设置面板 UI。
- Node.js 内置模块：`node:child_process`、`node:fs/promises`、`node:path`。

### 原生文件选择器（可选）

「选择本地图片」会调用系统原生文件框，按平台依赖以下命令：

| 平台 | 依赖命令 |
| --- | --- |
| macOS | `osascript`（系统自带） |
| Linux | `zenity` 或 `kdialog`（二者有其一即可） |
| Windows | `powershell` |

缺少上述命令时，仍可手动填写本地绝对路径。

## 已知限制与可能造成的影响

本插件通过**覆写 DSH 主题 token** 与**注入 CSS** 实现，会改动全局界面表现，使用时需留意以下几点：

1. **覆写全局背景 token `--dsw-alias-bg-base`**：所有引用该 token 的界面区域都会显示背景图。插件已用 CSS 把已知的面板/按钮强制回表面色（`--dsw-alias-bg-layer-2`），但 DSH 升级后新增的引用该 token 的元素可能需要同步补充。
2. **依赖 DSH 内部 hashed 类名**：连续背景与玻璃效果依赖 `.pI_x6G_frame`、`.wSkVaW_root`、`.ydkMvW_root`、`.hHd-Xa_root`、`.pI_x6G_sidebarCol`、`.uV2eYG_card`、`.wSkVaW_composerSeat` 等内部类名；DSH 升级若改动这些类名，对应效果会失效或错位。
3. **侧栏不做毛玻璃模糊**：设置弹层以 `position: fixed` 渲染在侧栏内，对侧栏施加 `backdrop-filter` 会把弹层锁进侧栏。因此侧栏只做「透明玻璃」，模糊仅作用于输入卡片（其内部无固定定位弹层，安全）。
4. **本地图片路由**：本地图片依赖主机端只读路由（仅回环、引用即授权），图片文件被移动或删除后背景会失效，需重新设置路径。

## 更新与卸载

更新到最新版：

```bash
npx @deepseek-ai/dsh plugin --profile <profile名> add dsh-plugin-background-image@latest
```

卸载插件：

```bash
npx @deepseek-ai/dsh plugin --profile <profile名> remove dsh-plugin-background-image
```

## 环境要求

- Node.js 18 或更高版本
- 已安装并可以正常使用 DeepSeek Harness
