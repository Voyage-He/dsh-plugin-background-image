/**
 * dsh-plugin-background-image — 主机端类型声明。
 * 主机端仅为占位插件：让本包出现在组合条目中，供客户端模块系统扫描
 * `dsh.client` 清单。无主机端逻辑。
 */
export const name: 'dsh-plugin-background-image'

/**
 * 主机端 apply：无操作。
 * @param ctx - 主机端 Cordis 上下文。
 */
export function apply(ctx: unknown): void
