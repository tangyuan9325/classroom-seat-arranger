# 重设计 UI 为 Claude(Anthropic) 风格 + 安全与稳定性修复

## 概述
本 PR 包含三部分改动：桌面版与在线版网页整体换装为 Claude 风格、移除硬编码 GitHub Token、以及若干 Bug 修复。

## 1. Claude (Anthropic) 风格 UI 重设计
- `docs/index.html`（在线版）与 `internal/seat/web/index.html`（Go 桌面内嵌版）的 `<style>` 整块替换为同一份主题（独立副本见 `claude-theme.css`）。
- 设计令牌：暖米白背景 #f0eee8、纸白卡片 #faf9f5、Claude 标志性陶土橙主色 #d97757（hover #c25d3d）、墨色文字 #141413、衬线标题字体、14px 圆角、柔和双层阴影；点缀 Ollie Blue #587fbf 与鼠尾草绿 #7f9d62。
- 座位卡、按钮、开关、输入框、Toast、弹窗遮罩、登录卡、图例等全部同步换色；旧的玻璃拟态（blur/深蓝渐变/#ff8fb0）已彻底清除。
- **兼容性**：保留全部旧 CSS 变量名作为语义别名，app.js 与 Go 后端零改动；HTML 结构/id/class/打印样式/响应式断点不变。

## 2. 安全：移除内嵌 GitHub Token
- `docs/app.js` 不再硬编码混淆的 PAT；改为运行时 `getWriteToken()`：首次写入时提示输入，存 localStorage，顶栏新增「Token」按钮可更换/清除。
- 未设置 token 时以只读模式运行（读取 state.json 走 raw/Pages 地址，无需凭据）；写入遇 401/403 自动清除失效 token 并提示重新设置。
- 全仓已确认无任何 `ghp_` 残留。

## 3. Bug 修复
- `internal/seat/rotate.go:120`：删除重复声明 `nc := cloneRoom(cr)`（此前导致整个项目无法编译）。
- 复审修复 8 处排座/导入导出逻辑缺陷（含 2 处可能导致学生数据丢失/重复的严重问题），详见各提交说明。

## 验证
- `go build ./...`、`go vet`、`go test`（ok）全部通过；
- `node --check docs/app.js` 通过；
- 两个 HTML 的 style 标签配对、CSS 花括号配平、关键 DOM id 完整；
- 桌面服务实机启动 HTTP 200，页面渲染新主题。

## 部署说明
合并后在仓库 Settings → Pages 选择 `main` 分支 `/docs` 目录即可上线在线版；首次使用时点「Token」输入仅含本仓库 contents:write 权限的 fine-grained token 恢复实时同步。
