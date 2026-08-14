# dsh-plugin-background-image

DeepSeek Harness 界面背景图片插件：网络/本地图片与预设渐变背景，支持开关、
透明度调节、沉浸式全屏或仅对话区域显示。设置入口在
设置 → 插件 → 插件配置 →「背景图片设置」。

本仓库即 npm 包根：完整 npm 元数据 + DSH 插件元数据
（`dsh.bundle` 组合补丁层 + `dsh.client` 客户端清单）。

## 安装（DSH 官方插件机制）

```bash
# 本地文件夹安装（无需发布）
npx @deepseek-ai/dsh plugin --profile <profile名> add \
  dsh-plugin-background-image@file:/路径/到/本仓库

# 或从 npm 安装（发布后）
npx @deepseek-ai/dsh plugin --profile <profile名> add dsh-plugin-background-image
```

安装后用该 profile 启动 DSH，客户端模块系统自动注入浏览器 bundle，
随 profile 常驻、重启自动生效。

卸载 / 升级：

```bash
npx @deepseek-ai/dsh plugin --profile <profile名> remove dsh-plugin-background-image
npx @deepseek-ai/dsh plugin --profile <profile名> add dsh-plugin-background-image@latest
```

## 发布到 npm

```bash
npm publish
```

（`publishConfig.access: public`；如需私有 registry 或作者/仓库字段，
按需在 package.json 中补充 `author`、`repository`、`bugs` 等标准字段。）

## 动态装载（任何部署可用，无需安装）

对于预构建 Web 部署，可把 `client.js` 作为动态插件装载：在会话中对 AI 说

> 请读取本仓库的 client.js，用 cordis_define 定义新动态插件
> （idPrefix: bgimg，仅 client 半），然后 cordis_run 激活。

动态插件是进程级临时的：每次重启进程后重复上述步骤；设置不持久化。

## 结构与原理

- `package.json` — npm 元数据 + `dsh.bundle.patch`（组合补丁）与
  `dsh.client.platform: web`（客户端清单）；
- `patch.yml` — 通过 `insert` 把本插件的行追加到 profile 根组合；
- `lib/index.js` — 主机端占位插件（让组合条目存在，供客户端模块系统扫描）；
- `lib/client.js` — 自注册客户端 bundle（`window.__ModuleLoader__.load`），
  实现全部界面与背景渲染逻辑；
- `lib/types/` — 主机端与客户端类型声明；
- `client.js` — 动态插件源（与 `lib/client.js` 同源，适配动态运行环境）。

## 注意事项

1. **类名补丁与构建相关**：客户端 CSS 中针对浮层/卡片/选择框的纯色补丁使用
   当前构建的哈希类名；DSH 前端升级后如这些类名变化，需更新 `lib/client.js`
   末尾的补丁选择器（功能不受影响，只是那些小控件可能再次透出背景图）。
2. **设置不持久化**：开关/图片选择保存在内存中，刷新页面或重启后需重新启用。
3. 需要 Node ≥ 18 与 pnpm 可用的环境（`dsh plugin` 内部转发 pnpm）。
