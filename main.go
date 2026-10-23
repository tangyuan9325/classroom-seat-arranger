package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"seatarranger/internal/seat"
)

var version = "v1.0.0"

func main() {
	port := flag.Int("port", 8017, "HTTP 服务端口")
	noBrowser := flag.Bool("no-browser", false, "不自动打开浏览器")
	showVersion := flag.Bool("version", false, "显示版本")
	headless := flag.Bool("headless", false, "命令行模式：生成一次排座并输出")
	outCSV := flag.String("out", "", "headless 模式下导出座位 CSV 的路径")
	randomize := flag.Bool("random", false, "headless 模式：纯随机排座")
	noHeight := flag.Bool("no-height", false, "headless 模式：不考虑身高")
	noPref := flag.Bool("no-pref", false, "headless 模式：不考虑偏好")
	flag.Parse()

	if *showVersion {
		fmt.Println("班级排座位软件", version)
		return
	}

	srv := seat.NewServer()

	if *headless {
		opt := seat.DefaultOptions()
		opt.Randomize = *randomize
		opt.UseHeight = !*noHeight
		opt.UsePref = !*noPref
		sts := make([]*seat.Student, len(srv.Students))
		for i := range srv.Students {
			sts[i] = &srv.Students[i]
		}
		cr := seat.Arrange(sts, srv.Layout, opt)
		fmt.Println("== 排座结果 ==")
		fmt.Println(renderText(cr))
		if *outCSV != "" {
			os.WriteFile(*outCSV, []byte("\uFEFF"+seat.ExportCSV(cr)), 0644)
			fmt.Println("已导出:", *outCSV)
		}
		return
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatalf("端口 %d 被占用，请用 -port 指定其他端口: %v", *port, err)
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", *port)
	fmt.Println("======================================")
	fmt.Println("  班级排座位软件", version)
	fmt.Println("  班级：2706 高三（内置 44 名学生）")
	fmt.Println("  布局：中间4列×6行 + 旁边4列×5行 = 44 座")
	fmt.Println("  请用浏览器打开：", url)
	fmt.Println("  按 Ctrl+C 退出")
	fmt.Println("======================================")

	if !*noBrowser {
		go func() {
			time.Sleep(500 * time.Millisecond)
			openBrowser(url)
		}()
	}
	log.Fatal(http.Serve(ln, srv.Handler()))
}

// openBrowser 跨平台打开默认浏览器。
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

// renderText 控制台文本排座图。
func renderText(cr *seat.ClassRoom) string {
	var b strings.Builder
	lay := cr.Layout
	for r := 0; r < lay.Rows; r++ {
		b.WriteString(fmt.Sprintf("第%d排  ", r+1))
		for c := 0; c < lay.Cols; c++ {
			cell := cr.GridFor(r, c)
			if cell == nil || cell.Empty || cell.Student == nil {
				b.WriteString("  .   ")
				continue
			}
			nm := []rune(cell.Student.Name)
			s := string(nm)
			if len(nm) == 2 {
				s = " " + s + " "
			}
			marker := "男"
			if cell.Student.Gender == "女" {
				marker = "女"
			}
			b.WriteString(fmt.Sprintf("%s%s ", s, marker))
		}
		b.WriteString("\n")
	}
	return b.String()
}

// 避免 unused 警告
var _ = strconv.Itoa
