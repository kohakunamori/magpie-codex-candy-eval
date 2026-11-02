# Magpie Codex Candy Eval

A **native Magpie plugin page** with a local Node.js runner for per-account Codex regression checks. Based on the MIT-licensed [CPA Codex Candy Eval](https://github.com/haowang02/cpa-plugin-codex-candy-eval), including the original MIT-licensed LM Fingerpoint Detector.

**Development status: v0.1.0 / initial implementation.** It has been unit-tested and builds the reference Go detector; **it has not yet been validated end-to-end against live Codex accounts**. Do not treat a fingerprint score or candy answer as proof of model downgrade.

## 功能

| 功能 | 当前实现 |
| --- | --- |
| 糖果题 | 1–10 次测试，答案 21，记录回答和正确率 |
| 鹈鹕 | 原版/多合一；收集 SVG/HTML 代码（仅文本预览，防止执行生成的脚本） |
| 数字指纹 | 随机选择 3 道原版挑战，使用 **原版 Go detector 与参考库**计算排序和概率 |
| 指定账号 | 使用官方 `X-Magpie-Account`，避免自动切号污染结果 |
| Magpie 原生页面 | 侧边栏展示，配置测试，历史记录，状态 |
| 历史 | 每账号/测试类型保留至多 20 条，保存到 Magpie 插件 options |
| 批量 | 用户在页面输入多个账号，一次按顺序测试 |
| 定时 | 可由系统计划任务执行 `once`；常驻 `watch` 监测页面提交的任务 |
| 自动降低/恢复账号优先级 | **尚未实现**；不会自动修改路由和账号权限 |

### 为什么需要本地 runner？

Magpie 的插件页面被浏览器严格沙箱隔离：不允许 `fetch`，不能读取账号列表或 Token，也不能直接发起模型请求。因此页面通过官方 `magpie.options.set` 写入用户确认的测试任务；运行器读取插件设置，通过官方本地网关发起请求，再使用 `magpie plugin options` 写回结果。无须更改 Magpie 源代码，也不访问 Magpie 的账号密钥文件。

## 安装（Windows/macOS/Linux）

依赖：**Magpie（支持插件页面的版本）**、**Node.js ≥22**、**Go ≥1.23**（指纹归因需要 Go；糖果与鹈鹕不需要）。

1. 克隆并安装原生插件：

   ```sh
   git clone https://github.com/kohakunamori/magpie-codex-candy-eval.git
   cd magpie-codex-candy-eval
   magpie plugin add .
   ```

2. **单独**打开终端，在同一目录启动测试运行器：

   ```sh
   node cli/index.mjs watch
   ```

3. 在 Magpie 的 Plugins 侧边栏打开 **Codex 降智测试**，输入模型 ID（如 `codex/gpt-6.1-sol`）和账号邮箱（与 Routing 页名称一致），选择测试后提交。

4. 如本地网关要求专门的网关密钥，在启动 runner 的终端设置环境变量 `MAGPIE_API_KEY`，**不要把密钥复制到页面配置或 Git 仓库**。

也可以使用 `magpie plugin add github:kohakunamori/magpie-codex-candy-eval` 安装 UI。runner 仍需克隆源码目录执行；插件不会自动启动任何后台程序。

## 命令行

```sh
node cli/index.mjs run --account 'account@example.com' --model codex/gpt-6.1-sol --type candy --effort low --runs 3
node cli/index.mjs run --account 'account@example.com' --model codex/gpt-6.1-sol --type fingerprint
node cli/index.mjs run --account 'account@example.com' --model codex/gpt-6.1-sol --type pelican --variant all-in-one
node cli/index.mjs once
node cli/index.mjs watch --interval 3000
```

`run` does **not** write to Magpie's plugin history; redirect its JSON output if desired. `once` processes one pending UI task (not an automatic recurring test). For scheduling, use the OS scheduler to invoke `run` with explicit parameters and save its output. The `watch` command may be left running while you use the plugin UI.

Configuration: `MAGPIE_BASE_URL` (default `http://127.0.0.1:3425/v1`), `MAGPIE_API_KEY` (defaults to local gateway key `magpie`), `--context simple|codex`, `--config PATH` to select a nonstandard `plugins.json`, `--magpie-bin PATH` for CLI. Non-loopback gateways are blocked unless `--allow-remote` is explicitly supplied.

## Important caveats

- **Costs:** the upstream CPA test sends a fresh, large Codex CLI-like context and consumes approximately 14k input tokens/request. This port includes its base instructions and stored context messages in `codex` mode, but **does not reproduce all upstream metadata and tool definitions**, so results are **not strictly comparable**. The `simple` mode is cheaper but less faithful.
- **Gateway transport:** this version submits non-streaming Chat Completions requests to Magpie, which translates them to the provider format. Some Codex setups may need a Responses-specific transport; such compatibility must be verified with a live, user-approved test.
- **Fingerprint attribution:** uses the original detector data and algorithm, but a probability is calibrated *only against the reference model bank*. Missing or malformed samples cause partial/failed attribution.
- **Account routing:** `X-Magpie-Account` pins by email/login/Routing id. The runner **requires an explicit account** and does not silently fall back to other accounts. Verify the returned usage record for the selected account when testing live.
- **Security:** generated HTML/SVG is shown as escaped text, not executed. The UI is sandboxed. The runner uses local CLI commands and never prints API keys.
- **No automatic routing change:** evaluations are informational only; a failed/incorrect response never disables a Magpie account.
- **Data:** histories are saved in the local Magpie `plugins.json` options. Clearing the page history removes that list, not usage logs. Avoid entering account secrets in any field.

## Testing

```sh
npm run check
npm test
go test ./cmd/fingerprint
```

CI runs checks on Linux and Windows. Tests are mock-based; they do not call real models or charge quota.

## Licensing

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). The Go detector reference bank carries its own MIT license in [cmd/fingerprint/data/lm-detector/LICENSE](cmd/fingerprint/data/lm-detector/LICENSE).

Upstream: [CPA Codex Candy Eval](https://github.com/haowang02/cpa-plugin-codex-candy-eval) · [LM Detector](https://github.com/Ikaleio/lm-detector) · [Magpie plugin docs](https://usemagpie.ai/docs/plugins).
