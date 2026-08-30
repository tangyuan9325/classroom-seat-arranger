// Package seat 实现班级座位安排的模型与算法。
package seat

import (
	"fmt"
	"math/rand"
	"sort"
	"strings"
)

// Student 一名学生及其调查数据（可选项）。
type Student struct {
	Name   string  `json:"name"`
	Gender string  `json:"gender"` // 男 / 女
	No     int     `json:"no"`     // 学号（可无）
	Height float64 `json:"height"` // 身高 cm，可选，0 表示未知

	// —— 调查问卷数据（可选）——
	SeatmatePref   []string `json:"seatmate_pref"`   // 期望同桌排序，越靠前越想要
	SingleDesk     bool     `json:"single_desk"`     // 单人单桌
	RowPref        int      `json:"row_pref"`        // -1 前排优先, 0 中排, +1 后排优先
	ColPref        int      `json:"col_pref"`        // -1 左侧, 0 中部, +1 右侧
	WeightSeatmate int      `json:"weight_seatmate"` // 同桌优先度 0-100
	WeightPos      int      `json:"weight_pos"`      // 位置优先度 0-100
}

// HasPref 是否填写了偏好数据。
func (s *Student) HasPref() bool {
	return len(s.SeatmatePref) > 0 || s.SingleDesk || s.RowPref != 0 || s.ColPref != 0 ||
		s.WeightSeatmate > 0 || s.WeightPos > 0
}

// Seat 一个座位。
type Seat struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

// SeatCell 座位网格中的一个单元。
type SeatCell struct {
	Student *Student `json:"student,omitempty"`
	Seat    Seat     `json:"seat"`
	Empty   bool     `json:"empty"`
	// 角色标记，供前端着色/标注
	IsGirlCol bool `json:"is_girl_col"`
	IsMiddle  bool `json:"is_middle"`
}

// FixedRules 固定座位规则（班主任硬性要求）。
type FixedRules struct {
	PodiumSeat string     `json:"podium_seat"` // 坐讲台旁单座的学生姓名（单人单座）
	FixedPairs [][]string `json:"fixed_pairs"` // 固定同桌（成对，必须相邻同桌）
	Alone      []string   `json:"alone"`       // 单人单座（同桌位留空）
}

// Layout 教室布局参数。
type Layout struct {
	Rows        int   `json:"rows"`         // 总行数（前后方向）
	Cols        int   `json:"cols"`         // 总列数（左右方向）
	MiddleCols  []int `json:"middle_cols"`  // 中间列（列索引从0开始）
	SideCols    []int `json:"side_cols"`    // 旁边列
	SideRows    int   `json:"side_rows"`    // 旁边列的排数（少于中间列，空出最后一排旁边）
	GirlCols    []int `json:"girl_cols"`    // 女生列
	GirlLastAlone bool `json:"girl_last_alone"` // 女生最后一排单人
	EmptySide   bool  `json:"empty_side"`   // true=旁边列少最后一排; false=少第一排
	GroupSize   int   `json:"group_size"`   // 两列一组
	Fixed       FixedRules `json:"fixed"`   // 固定座位规则
}

// DefaultLayout 默认布局：中间四列六行，旁边四列五行，共44座；两列一组。
func DefaultLayout() Layout {
	return Layout{
		Rows: 6, Cols: 8,
		MiddleCols:   []int{2, 3, 4, 5},
		SideCols:     []int{0, 1, 6, 7},
		SideRows:     5,
		GirlCols:     []int{4, 5}, // 女生占完整的一个两列组（右中组）
		GirlLastAlone: true,
		EmptySide:    true, // 旁边列少最后一排（后排只坐中间）
		GroupSize:    2,
		Fixed: FixedRules{
			PodiumSeat: "沙宇桐",
			FixedPairs: [][]string{{"杨天雪", "徐雨辰"}},
			Alone:      []string{"张千慧"},
		},
	}
}

// Seats 根据布局生成所有座位（按行从前往后、列从左到右）。
func (l Layout) Seats() []Seat {
	isSide := map[int]bool{}
	for _, c := range l.SideCols {
		isSide[c] = true
	}
	var out []Seat
	for r := 0; r < l.Rows; r++ {
		for c := 0; c < l.Cols; c++ {
			row := r
			if isSide[c] {
				// 旁边列只排 SideRows 排
				if l.EmptySide {
					// 空出最后一排：旁边列只到 SideRows-1
					if r >= l.SideRows {
						continue
					}
				} else {
					// 空出第一排：旁边列从 Rows-SideRows 开始
					if r < l.Rows-l.SideRows {
						continue
					}
					row = r // 保留原行号，方便展示
				}
			}
			out = append(out, Seat{Row: row, Col: c})
		}
	}
	return out
}

// SeatCount 座位总数。
func (l Layout) SeatCount() int { return len(l.Seats()) }

// IsMiddleCol 是否中间列。
func (l Layout) IsMiddleCol(c int) bool {
	for _, mc := range l.MiddleCols {
		if mc == c {
			return true
		}
	}
	return false
}

// IsGirlCol 是否女生列。
func (l Layout) IsGirlCol(c int) bool {
	for _, gc := range l.GirlCols {
		if gc == c {
			return true
		}
	}
	return false
}

// ClassRoom 一次排座的结果。
type ClassRoom struct {
	Layout Layout      `json:"layout"`
	Grid   []SeatCell  `json:"grid"`   // 按行主序
	Podium []SeatCell  `json:"podium"` // 讲台旁特殊座位（单人单座）
	Score  float64     `json:"score"`
}

// Grid 以行主序返回单元格。
func (c *ClassRoom) GridFor(r, col int) *SeatCell {
	for i := range c.Grid {
		if c.Grid[i].Seat.Row == r && c.Grid[i].Seat.Col == col {
			return &c.Grid[i]
		}
	}
	return nil
}

// SeatOf 返回某学生在网格中的位置。
func (c *ClassRoom) SeatOf(name string) *Seat {
	for i := range c.Grid {
		if c.Grid[i].Student != nil && c.Grid[i].Student.Name == name {
			return &c.Grid[i].Seat
		}
	}
	return nil
}

// 评分权重（可调）。
type Weights struct {
	Seatmate int     `json:"seatmate"` // 同桌匹配权重
	Pos      int     `json:"pos"`      // 位置偏好权重
	Height   float64 `json:"height"`   // 身高权重
	Mutual   float64 `json:"mutual"`   // 互相心仪加成
	Single   float64 `json:"single"`   // 单人单桌满足加成
}

// DefaultWeights 默认权重。
func DefaultWeights() Weights {
	return Weights{Seatmate: 50, Pos: 50, Height: 1.0, Mutual: 1.5, Single: 1.0}
}

// ===== 工具 =====

// SortByHeightDesc 按身高从高到低排序（未知身高排最后）。
func SortByHeightDesc(sts []*Student) {
	sort.SliceStable(sts, func(i, j int) bool {
		a, b := sts[i].Height, sts[j].Height
		if a == b {
			return false
		}
		return a > b
	})
}

// Shuffle 洗牌。
func Shuffle(sts []*Student, rng *rand.Rand) {
	rng.Shuffle(len(sts), func(i, j int) {
		sts[i], sts[j] = sts[j], sts[i]
	})
}

// RowZone 行区域：-1 前, 0 中, +1 后。
func (l Layout) RowZone(r int) int {
	third := l.Rows / 3
	switch {
	case r < third:
		return -1
	case r >= l.Rows-third:
		return 1
	default:
		return 0
	}
}

// ColZone 列区域：-1 左, 0 中, +1 右。
func (l Layout) ColZone(c int) int {
	mid := l.Cols / 2
	switch {
	case c < mid-1:
		return -1
	case c > mid:
		return 1
	default:
		return 0
	}
}

// NeighborSeats 返回同桌座位（同一行相邻列）。
func (l Layout) NeighborSeats(s Seat) []Seat {
	var out []Seat
	for _, dc := range []int{-1, 1} {
		nc := s.Col + dc
		if nc < 0 || nc >= l.Cols {
			continue
		}
		out = append(out, Seat{Row: s.Row, Col: nc})
	}
	return out
}

// String 布局概览。
func (l Layout) String() string {
	return fmt.Sprintf("中间%dx%d=中间列%v 旁边列%v 各%d排 共%d座",
		len(l.MiddleCols), l.Rows, l.MiddleCols, l.SideCols, l.SideRows, l.SeatCount())
}

// NormalizeGender 归一化性别字符。
func NormalizeGender(g string) string {
	g = strings.TrimSpace(g)
	switch g {
	case "女", "f", "F", "female", "Female", "girl", "0":
		return "女"
	default:
		return "男"
	}
}
