# 班级排座位系统 · 2706 高三

一个**编译型语言（Go）**编写、单文件、跨平台、可离线运行的班级智能排座软件。双击即用，自动打开浏览器（现代玻璃拟态 UI），无需安装任何环境。

## 功能

- **贴合班主任要求的内置布局**：中间 4 列 × 6 行 + 旁边 4 列 × 5 行 = 44 座（第 6 排只坐中间），9 名女生排中间两列（5+4，最后一名单独），其余 6 列为男生。
- **多种排座策略**：纯随机 / 按身高（高个靠后、矮个靠前）/ 结合调查偏好（期望同桌匹配 + 前后/左右位置偏好 + 同桌/位置权重）。
- **优化算法**：构造初始解 + 多轮局部搜索（同性别内随机交换、保留更优解），追求高评分排座。
- **公平轮换**：前后轮换（同列内向后移排）、左右轮换（保持女生列）、左右大组轮换（2 列一组循环），一键完成。
- **手动微调**：点击两个座位即可互换，兼容班主任现场调整。
- **导入导出**：支持导入 `.xlsx` / `.csv` 名单，导入调查偏好 CSV，导出座位表 CSV、打印/存图。
- **数据安全**：完全本地运行，数据不出本机。

## 内置班级名单

2706 高三 44 人（女生 9 人、男生 35 人），已内置，无需手动录入。也可通过「导入名单」替换为其他班级。

## 使用方法

### Windows（推荐）

1. 从 GitHub Releases 下载 `班级排座位-Windows-x64.exe`。
2. 双击运行，浏览器自动打开 `http://127.0.0.1:8017/`。
3. 点击「✨ 生成排位」得到初始排座；可用「轮换」实现公平轮换；「导入调查数据」可结合问卷偏好智能排座。

### 其他平台 / 命令行

```bash
# 启动图形界面（自动开浏览器）
./seat-arranger -port 8017

# 命令行一键排座并导出
./seat-arranger -headless -out seats.csv

# 命令行纯随机排座
./seat-arranger -headless -random -out seats.csv
```

## 命令行参数

| 参数 | 说明 |
|---|---|
| `-port` | HTTP 端口，默认 8017 |
| `-no-browser` | 不自动打开浏览器 |
| `-headless` | 命令行模式：生成一次排座并打印 |
| `-out` | 命令行模式导出座位 CSV 路径 |
| `-random` | 纯随机排座 |
| `-no-height` | 不考虑身高 |
| `-no-pref` | 不考虑偏好 |
| `-version` | 显示版本 |

## 调查数据格式

`data/survey_sample.csv` 为示例（44 人全部填写）。列：

```
name,gender,no,seatmate_pref,single_desk,row_pref,col_pref,weight_seatmate,weight_pos,height
葛姝玲,女,2,李知远|凌家玺|吴孜阳,false,前,中,70,30,155
```

- `seatmate_pref`：期望同桌，按心愿从高到低，用 `|` 分隔
- `single_desk`：是否单人单桌（true/false）
- `row_pref`：前后偏好 前/-1、中/0、后/1
- `col_pref`：左右偏好 左/-1、中/0、右/1
- `weight_seatmate` + `weight_pos`：同桌优先度与位置优先度（和为 100）
- `height`：身高（cm），可选

未填写的同学只参与姓名/性别匹配，不影响排座。

## 开发与构建

```bash
# 开发运行（本地服务）
go run . -port 8017

# 交叉编译 Windows .exe
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o bin/班级排座位-Windows-x64.exe .

# 编译 Linux / macOS
GOOS=linux  GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o bin/seat-arranger-linux-amd64 .
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o bin/seat-arranger-macos-amd64 .
```

也可直接运行 `scripts/build.sh`。

## 项目结构

```
seat-arranger/
├── main.go                 # 入口：CLI + 本地 HTTP 服务 + 自动开浏览器
├── internal/seat/
│   ├── model.go            # 学生/座位/布局/权重 模型
│   ├── arrange.go          # 排座：构造初始解 + 局部搜索优化 + 评分
│   ├── rotate.go           # 轮换：前后 / 左右(保女生列) / 大组
│   ├── io.go               # 名单/调查 CSV 解析与导出
│   ├── excel.go            # .xlsx 导入（excelize）
│   ├── web.go              # HTTP API
│   └── web/index.html      # 玻璃拟态网页 UI（内嵌进二进制）
├── data/survey_sample.csv  # 示例调查数据
└── scripts/build.sh        # 一键交叉编译脚本
```

## 算法说明

1. **硬约束**：9 名女生固定进入中间两列（5+4，最后一名单人），其余 6 列男生；全班 44 人全部入座。
2. **软目标（加权评分）**：
   - 同桌匹配：目标同桌位列越靠前得分越高，互相心仪加成；
   - 位置偏好：前后（前/中/后）、左右（左/中/右）与偏好一致得分；
   - 身高：高个靠后，避免遮挡视线。
3. **优化**：先按身高构造初始解，再执行数千轮「同性别随机交换 + 保留更优」的局部搜索，多起点选取最优。

## 许可

MIT
