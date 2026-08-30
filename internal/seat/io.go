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
	for i, row := range all {
		if i == 0 && len(row) > 0 && (strings.EqualFold(row[0], "no") || strings.EqualFold(row[0], "学号")) {
			continue
		}
		if len(row) < 3 {
			continue
		}
		var s Student
		s.No, _ = strconv.Atoi(strings.TrimSpace(row[0]))
		s.Name = strings.TrimSpace(row[1])
		if s.Name == "" {
			continue
		}
		s.Gender = NormalizeGender(row[2])
		if len(row) >= 4 {
			s.Height, _ = strconv.ParseFloat(strings.TrimSpace(row[3]), 64)
		}
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
	w.Write([]string{"name", "gender", "no", "seatmate_pref(用|分隔)", "single_desk", "row_pref", "col_pref", "weight_seatmate", "weight_pos", "height"})
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
