# dsh-plugin-background-image

一个用于 DeepSeek Harness（DSH）的背景图片插件。

它可以给 DSH 设置网络图片、本地图片或渐变背景，并支持调节透明度，以及选择全屏显示或仅在对话区域显示。

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
5. 根据需要调整透明度和显示范围。

## 配置存储

背景开关、显示范围、透明度和图片由 DSH 设置系统统一持久化到配置目录（默认 `~/.dsh/settings.yaml`），形如：

```yaml
background-image:
  enabled: true
  mode: fullscreen
  opacity: 0.9
  image: https://example.com/background.webp
```

- 刷新页面或重启 DSH 后自动恢复；
- 本地图片**直接记录绝对路径，不复制、不搬移**，文件留在原处：

```yaml
background-image:
  enabled: true
  mode: fullscreen
  opacity: 0.9
  image: /Users/you/Pictures/background.png
```

> 浏览器因安全策略不能直接加载 `file://` 资源，因此插件在 Host 注册了一个只读文件服务路由（`GET /plugins/background-image/file?path=<绝对路径>`），把被配置引用的本地图片以同源 http 方式提供给页面。该路由仅接受本机回环来源，且只允许读取 settings.yaml 当前 `image` 字段引用的那个路径（“引用即授权”，与官方 `session.attachment` 的授权模型一致）。若图片文件被移动或删除，背景会失效，需要重新设置路径。

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
