package seat

import (
	"bufio"
	"encoding/csv"
	"io"
	"sort"
	"strconv"
	"strings"
)

// DefaultStudents 内置 2706 班 44 名学生（学号/姓名/性别，来自名单）。
func DefaultStudents() []Student {
	rows := [][3]string{
		{"2", "葛姝玲", "女"}, {"3", "李知远", "女"}, {"4", "凌家玺", "女"},
		{"6", "吴孜阳", "女"}, {"7", "应沁晏", "女"}, {"8", "于欣冉", "女"},
		{"9", "张千慧", "女"}, {"43", "徐雨辰", "女"}, {"44", "杨天雪", "女"},
		{"11", "陈若铭", "男"}, {"12", "程泽航", "男"}, {"13", "翟振滔", "男"},
		{"14", "高歌", "男"}, {"15", "胡博文", "男"}, {"16", "胡哲源", "男"},
		{"17", "黄渝翔", "男"}, {"18", "赖泓哲", "男"}, {"19", "李成圆", "男"},
		{"20", "李乙禾", "男"}, {"21", "厉益和", "男"}, {"22", "刘炫华", "男"},
		{"23", "毛林轩", "男"}, {"24", "沙宇桐", "男"}, {"25", "沈嘉泽", "男"},
		{"26", "施浩哲", "男"}, {"27", "汤睿逸", "男"}, {"28", "汪楚航", "男"},
		{"29", "汪子涵", "男"}, {"30", "王浩然", "男"}, {"31", "翁境朗", "男"},
		{"32", "邬茗浩", "男"}, {"33", "徐绅源", "男"}, {"34", "严佳辉", "男"},
		{"35", "尤顺", "男"}, {"36", "詹天铭", "男"}, {"37", "张浩然", "男"},
		{"38", "赵潼鑫", "男"}, {"39", "郑子晨", "男"}, {"40", "朱颂喆", "男"},
		{"41", "朱彦奇", "男"}, {"42", "朱梓昊", "男"}, {"45", "方高博", "男"},
		{"46", "殷俊逸", "男"}, {"47", "张宇翔", "男"},
	}
	out := make([]Student, 0, len(rows))
	for _, r := range rows {
		no, _ := strconv.Atoi(r[0])
		out = append(out, Student{Name: r[1], Gender: NormalizeGender(r[2]), No: no})
	}
	return out
}

// ParseRosterCSV 解析名单 CSV。
// 表头：no,name,gender[,height]
func ParseRosterCSV(r io.Reader) ([]Student, error) {
	cr := csv.NewReader(bufio.NewReader(r))
	cr.TrimLeadingSpace = true
	all, err := cr.ReadAll()
	if err != nil {
		return nil, err
	}
	var sts []Student
	seen := map[string]bool{}
	// 表头驱动的列映射（兼容旧位置格式：name,gender,no,seatmate_pref,single_desk,row_pref,col_pref,weight_seatmate,weight_pos,height[,avoid_seatmate]）
	colIdx := map[string]int{
		"name": 0, "gender": 1, "no": 2, "seatmate_pref": 3, "single_desk": 4,
		"row_pref": 5, "col_pref": 6, "weight_seatmate": 7, "weight_pos": 8, "height": 9,
		"avoid_seatmate": -1,
	}
	if len(all) > 0 {
		hdr := make([]string, len(all[0]))
		for j, h := range all[0] {
			hdr[j] = strings.ToLower(strings.TrimSpace(h))
		}
		if len(hdr) > 0 && (strings.Contains(hdr[0], "name") || strings.Contains(hdr[0], "姓名")) {
			for j, h := range hdr {
				key := ""
				switch {
				case strings.HasPrefix(h, "avoid") || strings.Contains(h, "不希望"):
					key = "avoid_seatmate"
				case strings.Contains(h, "同桌") && !strings.Contains(h, "不"):
					key = "seatmate_pref"
				case strings.HasPrefix(h, "single"):
					key = "single_desk"
				case strings.HasPrefix(h, "row"):
					key = "row_pref"
				case strings.HasPrefix(h, "col"):
					key = "col_pref"
				case strings.HasPrefix(h, "weight_seatmate") || strings.HasPrefix(h, "w_seatmate"):
					key = "weight_seatmate"
				case strings.HasPrefix(h, "weight_pos") || strings.HasPrefix(h, "w_pos"):
					key = "weight_pos"
				case strings.HasPrefix(h, "name"):
					key = "name"
				case strings.HasPrefix(h, "gender"):
					key = "gender"
				case h == "no" || strings.HasPrefix(h, "学号"):
					key = "no"
				case strings.HasPrefix(h, "height"):
					key = "height"
				default:
					continue
				}
				colIdx[key] = j
			}
		}
	}
	get := func(row []string, key string) string {
		if j, ok := colIdx[key]; ok && j >= 0 && j < len(row) {
			return strings.TrimSpace(row[j])
		}
		return ""
	}
	splitNames := func(v string) []string {
		var out []string
		if v == "" {
			return out
		}
		for _, n := range strings.FieldsFunc(v, func(r rune) bool { return r == '|' || r == '、' || r == ',' || r == ';' }) {
			n = strings.TrimSpace(n)
			if n != "" {
				out = append(out, n)
			}
		}
		return out
	}
	for i, row := range all {
		if i == 0 {
			continue
		}
		if len(row) < 2 {
			continue
		}
		var s Student
		s.Name = get(row, "name")
		if s.Name == "" {
			continue
		}
		s.Gender = NormalizeGender(get(row, "gender"))
		s.No, _ = strconv.Atoi(get(row, "no"))
		s.SeatmatePref = splitNames(get(row, "seatmate_pref"))
		s.AvoidSeatmate = splitNames(get(row, "avoid_seatmate"))
		v := get(row, "single_desk")
		s.SingleDesk = strings.EqualFold(v, "true") || v == "1" || v == "是"
		s.RowPref = parseZone(get(row, "row_pref"))
		s.ColPref = parseZone(get(row, "col_pref"))
		s.WeightSeatmate, _ = strconv.Atoi(get(row, "weight_seatmate"))
		s.WeightPos, _ = strconv.Atoi(get(row, "weight_pos"))
		s.Height, _ = strconv.ParseFloat(get(row, "height"), 64)
		if !seen[s.Name] {
			sts = append(sts, s)
			seen[s.Name] = true
		}
	}
	sort.SliceStable(sts, func(i, j int) bool { return sts[i].No < sts[j].No })
	return sts, nil
}

// ParseSurveyCSV 解析调查结果 CSV（可包含名单与偏好）。
// 表头：name,gender,no,seatmate_pref(逗号分隔按序),single_desk,row_pref,col_pref,weight_seatmate,weight_pos,height
// row_pref: 前/中/后 或 -1/0/1；col_pref: 左/中/右 或 -1/0/1
func ParseSurveyCSV(r io.Reader) ([]Student, error) {
	cr := csv.NewReader(bufio.NewReader(r))
	cr.TrimLeadingSpace = true
	all, err := cr.ReadAll()
	if err != nil {
		return nil, err
	}
	var sts []Student
	seen := map[string]bool{}
	for i, row := range all {
		if i == 0 {
			continue
		}
		if len(row) < 2 {
			continue
		}
		var s Student
		s.Name = strings.TrimSpace(row[0])
		if s.Name == "" {
			continue
		}
		if len(row) > 1 {
			s.Gender = NormalizeGender(row[1])
		}
		if len(row) > 2 {
			s.No, _ = strconv.Atoi(strings.TrimSpace(row[2]))
		}
		if len(row) > 3 && strings.TrimSpace(row[3]) != "" {
			for _, n := range strings.Split(row[3], "|") {
				n = strings.TrimSpace(n)
				if n != "" {
					s.SeatmatePref = append(s.SeatmatePref, n)
				}
			}
		}
		if len(row) > 4 {
			s.SingleDesk = strings.EqualFold(strings.TrimSpace(row[4]), "true") || strings.TrimSpace(row[4]) == "1"
		}
		if len(row) > 5 {
			s.RowPref = parseZone(strings.TrimSpace(row[5]))
		}
		if len(row) > 6 {
			s.ColPref = parseZone(strings.TrimSpace(row[6]))
		}
		if len(row) > 7 {
			s.WeightSeatmate, _ = strconv.Atoi(strings.TrimSpace(row[7]))
		}
		if len(row) > 8 {
			s.WeightPos, _ = strconv.Atoi(strings.TrimSpace(row[8]))
		}
		if len(row) > 9 {
			s.Height, _ = strconv.ParseFloat(strings.TrimSpace(row[9]), 64)
		}
		if !seen[s.Name] {
			sts = append(sts, s)
			seen[s.Name] = true
		}
	}
	return sts, nil
}

func parseZone(v string) int {
	switch v {
	case "前", "前排", "front", "-1":
		return -1
	case "后", "后排", "back", "1":
		return 1
	case "左", "左侧", "left":
		return -1
	case "右", "右侧", "right":
		return 1
	case "中", "中排", "中部", "middle", "0":
		return 0
	}
	return 0
}

// splitNamesCSV 按 | 、 , ; 拆分姓名字段（问卷多选列的通用格式）。
func splitNamesCSV(v string) []string {
	var out []string
	if v == "" {
		return out
	}
	for _, n := range strings.FieldsFunc(v, func(r rune) bool { return r == '|' || r == '、' || r == ',' || r == ';' }) {
		n = strings.TrimSpace(n)
		if n != "" {
			out = append(out, n)
		}
	}
	return out
}

// ExportCSV 导出座位表 CSV。
func ExportCSV(cr *ClassRoom) string {
	var b strings.Builder
	bw := bufio.NewWriter(&b)
	w := csv.NewWriter(bw)
	w.Write([]string{"行", "列", "学号", "姓名", "性别", "身高(cm)", "区域"})
	for r := 0; r < cr.Layout.Rows; r++ {
		for c := 0; c < cr.Layout.Cols; c++ {
			cell := cr.GridFor(r, c)
			if cell == nil || cell.Empty {
				continue
			}
			st := cell.Student
			zone := "旁"
			if cr.Layout.IsMiddleCol(c) {
				zone = "中"
			}
			row := []string{
				strconv.Itoa(r + 1), strconv.Itoa(c + 1),
				strconv.Itoa(st.No), st.Name, st.Gender,
			}
			h := ""
			if st.Height > 0 {
				h = strconv.FormatFloat(st.Height, 'f', 1, 64)
			}
			row = append(row, h, zone)
			w.Write(row)
		}
	}
	w.Flush()
	bw.Flush()
	return b.String()
}

// ExportCSVRoster 导出名单（含偏好占位列）。
func ExportCSVRoster(sts []Student) string {
	var b strings.Builder
	bw := bufio.NewWriter(&b)
	w := csv.NewWriter(bw)
	w.Write([]string{"name", "gender", "no", "seatmate_pref(用|分隔)", "single_desk", "row_pref", "col_pref", "weight_seatmate", "weight_pos", "height", "avoid_seatmate(用|分隔)"})
	for i := range sts {
		w.Write([]string{
			sts[i].Name, sts[i].Gender, strconv.Itoa(sts[i].No),
			strings.Join(sts[i].SeatmatePref, "|"),
			strconv.FormatBool(sts[i].SingleDesk),
			strconv.Itoa(sts[i].RowPref), strconv.Itoa(sts[i].ColPref),
			strconv.Itoa(sts[i].WeightSeatmate), strconv.Itoa(sts[i].WeightPos),
			strconv.FormatFloat(sts[i].Height, 'f', 1, 64),
		})
	}
	w.Flush()
	bw.Flush()
	return b.String()
}

// ---------- 问卷调查（网页版问卷区域导入/导出） ----------

// SurveyAnswers 单个学生的问卷回答。
type SurveyAnswers struct {
	Name          string   `json:"name"`
	No            int      `json:"no"`
	RowPref       int      `json:"row_pref"`       // -1 前排, 0 中排, +1 后排
	SeatmateWant  []string `json:"seatmate_want"`  // 希望坐旁边（多选）
	SeatmateAvoid []string `json:"seatmate_avoid"` // 不希望坐旁边（多选）
}

// ParseSurveyAnswersCSV 解析网页问卷导出的 CSV：
// name,no,row_pref(-1/0/+1),seatmate_want(用|分隔),seatmate_avoid(用|分隔)
func ParseSurveyAnswersCSV(r io.Reader) ([]SurveyAnswers, error) {
	cr := csv.NewReader(bufio.NewReader(r))
	cr.TrimLeadingSpace = true
	all, err := cr.ReadAll()
	if err != nil {
		return nil, err
	}
	var out []SurveyAnswers
	seen := map[string]bool{}
	for i, row := range all {
		if i == 0 {
			continue
		}
		if len(row) < 1 {
			continue
		}
		var a SurveyAnswers
		a.Name = strings.TrimSpace(row[0])
		if a.Name == "" || seen[a.Name] {
			continue
		}
		seen[a.Name] = true
		if len(row) > 1 {
			a.No, _ = strconv.Atoi(strings.TrimSpace(row[1]))
		}
		if len(row) > 2 {
			a.RowPref = parseZone(strings.TrimSpace(row[2]))
		}
		if len(row) > 3 {
			a.SeatmateWant = splitNamesCSV(strings.TrimSpace(row[3]))
		}
		if len(row) > 4 {
			a.SeatmateAvoid = splitNamesCSV(strings.TrimSpace(row[4]))
		}
		out = append(out, a)
	}
	return out, nil
}

// ApplySurveyToRoster 把问卷回答合并进名单：位置优先度、希望同桌（按顺序，去重）、
// 不希望同桌；未提交问卷的学生清空旧问卷偏好（保留 single_desk/height 等其它字段）。
func ApplySurveyToRoster(sts []Student, answers []SurveyAnswers) []Student {
	idx := map[string]int{}
	for i := range sts {
		idx[strings.TrimSpace(sts[i].Name)] = i
	}
	cleared := map[int]bool{}
	for i := range sts {
		sts[i].SeatmatePref = nil
		sts[i].AvoidSeatmate = nil
		sts[i].RowPref = 0
	}
	for _, a := range answers {
		i, ok := idx[strings.TrimSpace(a.Name)]
		if !ok {
			continue
		}
		st := &sts[i]
		st.RowPref = a.RowPref
		// 问卷填写即视为启用偏好：默认优先度 50/50（用户可经名单 CSV 覆盖）
		if st.WeightSeatmate == 0 && st.WeightPos == 0 {
			st.WeightSeatmate, st.WeightPos = 50, 50
		}
		seenW := map[string]bool{}
		for _, n := range a.SeatmateWant {
			n = strings.TrimSpace(n)
			if n == "" || n == st.Name || seenW[n] {
				continue
			}
			seenW[n] = true
			st.SeatmatePref = append(st.SeatmatePref, n)
		}
		seenA := map[string]bool{}
		for _, n := range a.SeatmateAvoid {
			n = strings.TrimSpace(n)
			if n == "" || n == st.Name || seenA[n] {
				continue
			}
			seenA[n] = true
			st.AvoidSeatmate = append(st.AvoidSeatmate, n)
		}
		cleared[i] = true
	}
	return sts
}

// ExportSurveyTemplateCSV 导出空白问卷模板（供线下发放填写）。
func ExportSurveyTemplateCSV(sts []Student) string {
	var b strings.Builder
	bw := bufio.NewWriter(&b)
	w := csv.NewWriter(bw)
	w.Write([]string{"name", "no", "row_pref(-1前排/0中排/+1后排)", "seatmate_want(希望同桌,用|分隔)", "seatmate_avoid(不希望同桌,用|分隔)"})
	for i := range sts {
		w.Write([]string{sts[i].Name, strconv.Itoa(sts[i].No), "", "", ""})
	}
	w.Flush()
	bw.Flush()
	return b.String()
}

// ExportSurveySummaryCSV 导出当前问卷汇总（每行一名学生及其问卷内容）。
func ExportSurveySummaryCSV(sts []Student) string {
	var b strings.Builder
	bw := bufio.NewWriter(&b)
	w := csv.NewWriter(bw)
	w.Write([]string{"name", "no", "row_pref", "seatmate_want(用|分隔)", "seatmate_avoid(用|分隔)"})
	for i := range sts {
		st := &sts[i]
		rowPref := "中排"
		switch st.RowPref {
		case -1:
			rowPref = "前排"
		case 1:
			rowPref = "后排"
		}
		w.Write([]string{st.Name, strconv.Itoa(st.No), rowPref, strings.Join(st.SeatmatePref, "|"), strings.Join(st.AvoidSeatmate, "|")})
	}
	w.Flush()
	bw.Flush()
	return b.String()
}
