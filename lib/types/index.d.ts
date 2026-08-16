/**
 * dsh-plugin-background-image — 主机端类型声明。
 * 主机端注册背景图片设置命名空间（enabled / mode / opacity / image /
 * blur / saturation / sidebarOpacity / composerOpacity / contentOffset），
 * 并注册本地图片文件服务路由、配置读写路由与原生文件选择路由。
 */
export const name: 'dsh-plugin-background-image'

/**
 * 主机端 apply：注册 settings 命名空间与 webServer 路由。
 * @param ctx - 主机端 Cordis 上下文。
 */
export function apply(ctx: unknown): void
