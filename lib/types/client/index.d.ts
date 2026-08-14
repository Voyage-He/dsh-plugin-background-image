/**
 * dsh-plugin-background-image — 客户端 bundle 类型声明。
 * 实际模块通过 `window.__ModuleLoader__.load` 自注册，运行时按
 * `window.__DSH_BOOT__` 启动图加载本脚本。
 */
declare const plugin: {
  /** 客户端插件名，与组合行 id 一致。 */
  name: 'dsh-plugin-background-image'
  /** 依赖的客户端服务。 */
  inject: ['theme', 'slots', 'timer']
  /**
   * 客户端 apply：注册设置卡片（settings.plugin.item）、插入样式，
   * 并通过 theme.overrideTokens 注入背景图。
   */
  apply(ctx: unknown): void
}

export default plugin
