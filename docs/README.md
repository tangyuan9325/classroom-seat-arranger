# 班级排座位 · 在线同步版（GitHub Pages）

本目录是 **GitHub Pages 静态网站**，与桌面版（Go）算法一致，额外支持**多人在线实时同步**：

- 老师（管理员）在浏览器输入 GitHub Token → 排座/换座/轮换 → 点「保存并同步」→ 座位状态写入本仓库 `docs/data/state.json`
- 学生/家长（访客）访问网站即**只读实时查看**，老师每次保存后，访客端每 5 秒自动刷新，无需刷新页面

## 使用

1. 网站地址：`https://tangyuan9325.github.io/classroom-seat-arranger/`
2. 老师首次使用：左侧「管理员同步设置」填入 GitHub Token（仅保存在自己的浏览器），点「保存 Token」
3. 生成/调整座位后点「📤 保存并同步」
4. 访客打开同一网址即可看到最新座位

## 说明

- 同步通过 GitHub 仓库内的 `state.json` 实现（天然带历史版本记录）
- 班级名单 `data/roster.json`、共享状态 `data/state.json`
- 本地开发：`python3 -m http.server 8080` 在 `site/` 目录下启动即可预览
