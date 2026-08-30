package seat

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
)

//go:embed web
var webFS embed.FS

// Server 排座服务状态。
type Server struct {
	Students  []Student
	Layout    Layout
	Current   *ClassRoom
	RNG       *rand.Rand
}

// NewServer 新建服务，载入内置名单与默认布局。
func NewServer() *Server {
	sts := DefaultStudents()
	lay := DefaultLayout()
	return &Server{
		Students: sts,
		Layout:   lay,
		RNG:      rand.New(rand.NewSource(rand.Int63())),
	}
}

// Handler 返回 http.Handler。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/roster", s.handleRoster)
	mux.HandleFunc("/api/import", s.handleImport)
	mux.HandleFunc("/api/import-survey", s.handleImportSurvey)
	mux.HandleFunc("/api/arrange", s.handleArrange)
	mux.HandleFunc("/api/rotate", s.handleRotate)
	mux.HandleFunc("/api/swap", s.handleSwap)
	mux.HandleFunc("/api/export/seat-csv", s.handleExportSeatCSV)
	mux.HandleFunc("/api/export/roster-csv", s.handleExportRosterCSV)
	return mux
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	data, err := webFS.ReadFile("web/index.html")
	if err != nil {
		http.Error(w, "web asset missing: "+err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

func (s *Server) handleRoster(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"students": s.Students,
		"layout":   s.Layout,
		"current":  s.Current,
		"girls":    countGender(s.Students, "女"),
		"boys":     countGender(s.Students, "男"),
		"seats":    s.Layout.SeatCount(),
	})
}

func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeErr(w, "上传解析失败: "+err.Error())
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, "缺少文件")
		return
	}
	defer file.Close()
	name := strings.ToLower(r.FormValue("name"))
	var sts []Student
	if strings.HasSuffix(name, ".xlsx") {
		sts, err = parseXLSX(file)
	} else {
		sts, err = ParseRosterCSV(file)
	}
	if err != nil {
		writeErr(w, "解析失败: "+err.Error())
		return
	}
	if len(sts) == 0 {
		writeErr(w, "未解析到学生")
		return
	}
	s.Students = sts
	writeJSON(w, map[string]any{"ok": true, "students": sts, "girls": countGender(sts, "女"), "boys": countGender(sts, "男")})
}

func (s *Server) handleImportSurvey(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeErr(w, "上传解析失败: "+err.Error())
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, "缺少文件")
		return
	}
	defer file.Close()
	sts, err := ParseSurveyCSV(file)
	if err != nil {
		writeErr(w, "解析失败: "+err.Error())
		return
	}
	if len(sts) == 0 {
		writeErr(w, "未解析到学生")
		return
	}
	// 与当前名单按姓名合并
	cur := map[string]*Student{}
	for i := range s.Students {
		cur[s.Students[i].Name] = &s.Students[i]
	}
	for i := range sts {
		if c, ok := cur[sts[i].Name]; ok {
			c.SeatmatePref = sts[i].SeatmatePref
			c.SingleDesk = sts[i].SingleDesk
			c.RowPref = sts[i].RowPref
			c.ColPref = sts[i].ColPref
			c.WeightSeatmate = sts[i].WeightSeatmate
			c.WeightPos = sts[i].WeightPos
			if sts[i].Height > 0 {
				c.Height = sts[i].Height
			}
		}
	}
	writeJSON(w, map[string]any{"ok": true, "students": s.Students})
}

type arrangeReq struct {
	Layout     *Layout `json:"layout"`
	Randomize  bool    `json:"randomize"`
	UseHeight  bool    `json:"use_height"`
	UsePref    bool    `json:"use_pref"`
	Iterations int     `json:"iterations"`
	Weights    *Weights `json:"weights"`
}

func (s *Server) handleArrange(w http.ResponseWriter, r *http.Request) {
	var req arrangeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, "参数解析失败: "+err.Error())
		return
	}
	lay := s.Layout
	if req.Layout != nil {
		lay = *req.Layout
		s.Layout = lay
	}
	opt := DefaultOptions()
	opt.Randomize = req.Randomize
	opt.UseHeight = req.UseHeight
	opt.UsePref = req.UsePref
	if req.Iterations > 0 {
		opt.Iterations = req.Iterations
	}
	if req.Weights != nil {
		opt.Weights = *req.Weights
	}
	// 权重：若调查填写则按学生平均
	sts := make([]*Student, len(s.Students))
	for i := range s.Students {
		sts[i] = &s.Students[i]
	}
	// 将默认权重与全班平均偏好权重校准
	if avgSW, avgPW := avgWeights(s.Students); avgSW+avgPW > 0 {
		opt.Weights.Seatmate = avgSW
		opt.Weights.Pos = avgPW
	}
	cr := Arrange(sts, lay, opt)
	s.Current = cr
	writeJSON(w, map[string]any{"ok": true, "room": cr, "score": cr.Score})
}

func (s *Server) handleRotate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode string `json:"mode"` // row / colgroup / colkeep
	}
	json.NewDecoder(r.Body).Decode(&req)
	if s.Current == nil {
		writeErr(w, "请先生成座位")
		return
	}
	var mode Rotation
	switch req.Mode {
	case "row":
		mode = RotRow
	case "colgroup":
		mode = RotColGroup
	default:
		mode = RotColKeepGirl
	}
	nc := Rotate(s.Current, mode)
	s.Current = nc
	writeJSON(w, map[string]any{"ok": true, "room": nc})
}

func (s *Server) handleSwap(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name1 string `json:"name1"`
		Name2 string `json:"name2"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if s.Current == nil {
		writeErr(w, "请先生成座位")
		return
	}
	a := s.Current.SeatOf(req.Name1)
	b := s.Current.SeatOf(req.Name2)
	if a == nil || b == nil {
		writeErr(w, "找不到学生")
		return
	}
	cellA := s.Current.GridFor(a.Row, a.Col)
	cellB := s.Current.GridFor(b.Row, b.Col)
	cellA.Student, cellB.Student = cellB.Student, cellA.Student
	writeJSON(w, map[string]any{"ok": true, "room": s.Current})
}

func (s *Server) handleExportSeatCSV(w http.ResponseWriter, r *http.Request) {
	if s.Current == nil {
		writeErr(w, "请先生成座位")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=seats.csv")
	w.Write([]byte("\uFEFF"))
	io.WriteString(w, ExportCSV(s.Current))
}

func (s *Server) handleExportRosterCSV(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=roster_template.csv")
	w.Write([]byte("\uFEFF"))
	io.WriteString(w, ExportCSVRoster(s.Students))
}

// ===== helpers =====

func countGender(sts []Student, g string) int {
	n := 0
	for i := range sts {
		if sts[i].Gender == g {
			n++
		}
	}
	return n
}

func avgWeights(sts []Student) (int, int) {
	sw, pw, n := 0, 0, 0
	for i := range sts {
		if sts[i].WeightSeatmate+sts[i].WeightPos > 0 {
			sw += sts[i].WeightSeatmate
			pw += sts[i].WeightPos
			n++
		}
	}
	if n == 0 {
		return 0, 0
	}
	// 归一化到和为100
	total := sw + pw
	if total == 0 {
		return 50, 50
	}
	return int(float64(sw*100)/float64(total) + 0.5), int(float64(pw*100)/float64(total) + 0.5)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, msg string) {
	writeJSON(w, map[string]any{"ok": false, "error": msg})
}

// parseXLSX 解析 xlsx 名单（第一行表头，列：学号/姓名/性别[/身高]）。
func parseXLSX(r io.Reader) ([]Student, error) {
	f, err := openXLSX(r)
	if err != nil {
		return nil, err
	}
	sheet := "Sheet1"
	rows, err := f.GetRows(sheet)
	if err != nil {
		// 尝试第一个 sheet
		shs := f.GetSheetList()
		if len(shs) == 0 {
			return nil, fmt.Errorf("无工作表")
		}
		rows, err = f.GetRows(shs[0])
		if err != nil {
			return nil, err
		}
	}
	var sts []Student
	seen := map[string]bool{}
	for i, row := range rows {
		if len(row) == 0 {
			continue
		}
		// 跳过表头：第一行若含"姓名"/"name"等
		if i == 0 {
			isHeader := false
			for _, c := range row {
				l := strings.ToLower(c)
				if strings.Contains(l, "姓名") || strings.Contains(l, "name") || strings.Contains(l, "性别") {
					isHeader = true
					break
				}
			}
			if isHeader {
				continue
			}
		}
		// 列：可能 [学号,姓名,性别] 或 [姓名,性别] 或 [2706,姓名,学号,性别]
		var s Student
		joined := strings.Join(row, "|")
		_ = joined
		// 尝试多种列布局：找出"姓名"与"性别"
		var name, gender string
		var no int
		if len(row) >= 4 {
			// 常见：班级/学号/姓名/性别 或 学号/姓名/性别/...
			// 判断哪一列像姓名（中文2-4字且不是纯数字）
			for ci, c := range row {
				cc := strings.TrimSpace(c)
				if cc == "" {
					continue
				}
				if (isChineseName(cc)) && name == "" && !isGenderWord(cc) {
					name = cc
					if ci+1 < len(row) && isGenderWord(row[ci+1]) {
						gender = row[ci+1]
					} else if ci-1 >= 0 && isGenderWord(row[ci-1]) {
						gender = row[ci-1]
					}
				}
				if isGenderWord(cc) && gender == "" {
					gender = cc
				}
			}
			// 学号：找纯数字列
			for _, c := range row {
				if v, err := strconv.Atoi(strings.TrimSpace(c)); err == nil && v > 0 && v < 1000 {
					no = v
				}
			}
		} else if len(row) >= 3 {
			no, _ = strconv.Atoi(strings.TrimSpace(row[0]))
			name = strings.TrimSpace(row[1])
			gender = strings.TrimSpace(row[2])
		} else if len(row) >= 2 {
			name = strings.TrimSpace(row[0])
			gender = strings.TrimSpace(row[1])
		}
		if name == "" || isGenderWord(name) || isNumeric(name) {
			continue
		}
		s.Name = name
		s.Gender = NormalizeGender(gender)
		s.No = no
		if !seen[s.Name] {
			sts = append(sts, s)
			seen[s.Name] = true
		}
	}
	if len(sts) == 0 {
		return nil, fmt.Errorf("未能在表格中识别到学生（请确认含姓名、性别列）")
	}
	return sts, nil
}

func isChineseName(s string) bool {
	n := 0
	for _, r := range s {
		if r >= 0x4e00 && r <= 0x9fff {
			n++
		}
	}
	return n >= 2 && n <= 4 && len([]rune(s)) <= 4
}

func isGenderWord(s string) bool {
	s = strings.TrimSpace(s)
	return s == "男" || s == "女" || strings.EqualFold(s, "男") || strings.EqualFold(s, "女")
}

func isNumeric(s string) bool {
	_, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return err == nil
}
