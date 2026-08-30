# 班级排座位 · 在线同步版（GitHub Pages）

本目录是 **GitHub Pages 静态网站**，与桌面版（Go）算法一致，额外支持**多人在线实时同步**：

- 老师（管理员）在浏览器输入 GitHub Token → 排座/换座/轮换 → 点「保存并同步」→ 座位状态写入本仓库 `docs/data/state.json`
- 学生/家长（访客）访问网站即**只读实时查看**，老师保存后约 **1~2 分钟内**自动同步到所有访客（GitHub Pages 自动重建时间），访客端每 5 秒轮询检测，无需手动刷新页面

## 使用

1. 网站地址：`https://tangyuan9325.github.io/classroom-seat-arranger/`
2. 老师首次使用：左侧「管理员同步设置」填入 GitHub Token（仅保存在自己的浏览器），点「保存 Token」
3. 生成/调整座位后点「📤 保存并同步」
4. 访客打开同一网址即可看到最新座位

## 同步原理

- **共享状态文件**：`docs/data/state.json`（含 `updated_at`、座位网格、固定规则等），是唯一权威来源
- **老师保存**：用 GitHub Contents API 覆盖 `state.json`（自动带 `sha` 防冲突），保存后 GitHub Pages 自动重建
- **访客同步**：前端每 5 秒并行轮询 GitHub Pages 与 raw 两个静态源，取 `updated_at` 最新者渲染；检测到变化即自动更新
- **历史追溯**：每次保存都是一个 Git 提交，天然带版本历史，可回滚

## 数据与隐私提醒

- 仓库为**公开仓库**，班级学生姓名名单公开可见（GitHub Pages 免费版不支持私密仓库）
- 如需名单保密：① 换用 GitHub 私密仓库（则 Pages 在线版不可用，仅保留桌面版）；② 或改用自建服务器方案
- GitHub Token 仅保存在老师本人浏览器 `localStorage`，不会上传到网站文件

## 本地开发

```bash
# 在 docs 目录起本地服务预览（相对路径会读取本地 data/）
cd docs && python3 -m http.server 8080
```

- 班级名单：`data/roster.json`
- 共享座位状态：`data/state.json`
