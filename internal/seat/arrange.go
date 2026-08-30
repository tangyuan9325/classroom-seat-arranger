package seat

import (
	"math/rand"
	"sort"
)

// Options 排座选项。
type Options struct {
	Randomize bool    // 完全不参考偏好/身高，纯随机
	UseHeight bool    // 是否考虑身高（高个靠后）
	UsePref   bool    // 是否使用调查偏好
	Iterations int    // 优化迭代次数
	Weights   Weights // 评分权重
	RNG       *rand.Rand
	// 女生列排不满时剩余座位是否由男生补满（默认 true，确保全员入座）
	FillOverflow bool
}

// DefaultOptions 默认选项。
func DefaultOptions() Options {
	return Options{
		Randomize:    false,
		UseHeight:    true,
		UsePref:      true,
		Iterations:   4000,
		Weights:      DefaultWeights(),
		FillOverflow: true,
	}
}

// Arrange 生成一份座位安排。
func Arrange(sts []*Student, layout Layout, opt Options) *ClassRoom {
	if opt.Iterations <= 0 {
		opt.Iterations = 4000
	}
	if opt.RNG == nil {
		opt.RNG = rand.New(rand.NewSource(rand.Int63()))
	}
	cr := buildInitial(sts, layout, opt)
	if !opt.Randomize {
		cr = optimize(cr, opt)
	}
	cr.Score = score(cr, opt)
	return cr
}

// buildInitial 构造一个初始可行解：女生入女生列，男生入其余列。
func buildInitial(sts []*Student, layout Layout, opt Options) *ClassRoom {
	// 按列分座
	type colSeats struct {
		col   int
		seats []Seat // 该列座位，按行升序（前排在前）
	}
	colMap := map[int][]Seat{}
	var order []int
	for _, s := range layout.Seats() {
		colMap[s.Col] = append(colMap[s.Col], s)
	}
	// 稳定列顺序：女生列优先列出
	seen := map[int]bool{}
	for _, c := range layout.GirlCols {
		colMap[c] = colMap[c]
		order = append(order, c)
		seen[c] = true
	}
	for c := 0; c < layout.Cols; c++ {
		if !seen[c] {
			order = append(order, c)
		}
	}
	// 每列座位按行升序
	for c := range colMap {
		sort.Slice(colMap[c], func(i, j int) bool { return colMap[c][i].Row < colMap[c][j].Row })
	}

	var girls, boys []*Student
	for i := range sts {
		if sts[i].Gender == "女" {
			girls = append(girls, sts[i])
		} else {
			boys = append(boys, sts[i])
		}
	}

	// 每列分配的座位（女生列也可能因溢出容纳男生）
	assign := map[string]*Seat{} // name -> seat
	used := map[Seat]bool{}

	// 女生填入女生列：优先前排，两列交替，最后一排单人
	girlSeats := []Seat{}
	for _, c := range layout.GirlCols {
		girlSeats = append(girlSeats, colMap[c]...)
	}
	// 女生列座位按“列交替 + 行前到后”排序：把女生均匀铺进两列
	placeGirls := func(g []*Student) {
		if len(g) == 0 {
			return
		}
		if opt.Randomize {
			Shuffle(g, opt.RNG)
		} else if opt.UseHeight {
			// 高个靠后：行从后往前填
		}
		// 排序女生座位：第一列前排优先，第二列前排优先（交替两列便于同桌）
		seatOrder := []Seat{}
		for r := 0; r < layout.Rows; r++ {
			for _, c := range layout.GirlCols {
				for _, s := range colMap[c] {
					if s.Row == r {
						seatOrder = append(seatOrder, s)
					}
				}
			}
		}
		// 高个靠后 -> 把学生按身高升序（矮在前）放入前排优先的座位序列
		ordered := make([]*Student, len(g))
		copy(ordered, g)
		if opt.UseHeight && !opt.Randomize {
			sort.SliceStable(ordered, func(i, j int) bool {
				a, b := ordered[i].Height, ordered[j].Height
				if a == b {
					return false
				}
				return a < b
			})
		}
		// 若启用“最后一排单人”：把最后一名女生单独放到最后一排中间列
		seatOrder = seatOrder[:len(ordered)]
		if layout.GirlLastAlone && !opt.Randomize && len(ordered) >= 1 {
			// 找到女生列中行号最大的座位
			maxRow := -1
			var lastSeat Seat
			for _, s := range seatOrder {
				if s.Row > maxRow {
					maxRow = s.Row
					lastSeat = s
				}
			}
			// 把 lastSeat 与 seatOrder 最后一位交换，使最后一名女生单人坐最后排
			for i := range seatOrder {
				if seatOrder[i] == lastSeat {
					seatOrder[i], seatOrder[len(seatOrder)-1] = seatOrder[len(seatOrder)-1], seatOrder[i]
					break
				}
			}
		}
		for i, s := range seatOrder {
			assign[ordered[i].Name] = &seatOrder[i]
			used[s] = true
		}
	}
	placeGirls(girls)

	// 男生填入其余列（含女生列剩余空位）
	restSeats := []Seat{}
	for _, c := range order {
		for _, s := range colMap[c] {
			if !used[s] {
				restSeats = append(restSeats, s)
			}
		}
	}
	ordered := make([]*Student, len(boys))
	copy(ordered, boys)
	if opt.Randomize {
		Shuffle(ordered, opt.RNG)
	} else if opt.UseHeight {
		sort.SliceStable(ordered, func(i, j int) bool {
			a, b := ordered[i].Height, ordered[j].Height
			if a == b {
				return false
			}
			return a < b
		})
	}
	for i, s := range restSeats {
		if i >= len(ordered) {
			break
		}
		assign[ordered[i].Name] = &restSeats[i]
		used[s] = true
	}

	// 组装网格
	cr := &ClassRoom{Layout: layout}
	for _, s := range layout.Seats() {
		cell := SeatCell{Seat: s, Empty: true}
		cell.IsMiddle = layout.IsMiddleCol(s.Col)
		cell.IsGirlCol = layout.IsGirlCol(s.Col)
		cr.Grid = append(cr.Grid, cell)
	}
	for name, seat := range assign {
		for i := range cr.Grid {
			if cr.Grid[i].Seat == *seat {
				for j := range sts {
					if sts[j].Name == name {
						cr.Grid[i].Student = sts[j]
						cr.Grid[i].Empty = false
						break
					}
				}
			}
		}
	}
	return cr
}

// score 评分：同桌匹配 + 位置偏好 + 身高。
func score(cr *ClassRoom, opt Options) float64 {
	total := 0.0
	idx := map[string]int{}
	for i := range cr.Grid {
		if cr.Grid[i].Student != nil {
			idx[cr.Grid[i].Student.Name] = i
		}
	}
	for i := range cr.Grid {
		cell := &cr.Grid[i]
		st := cell.Student
		if st == nil {
			continue
		}
		s := cell.Seat
		// 1) 同桌匹配
		if opt.UsePref && len(st.SeatmatePref) > 0 {
			neighbors := cr.Layout.NeighborSeats(s)
			for _, nb := range neighbors {
				ni, ok := idxOfNeighbor(cr, nb)
				if !ok {
					continue
				}
				nbSt := cr.Grid[ni].Student
				if nbSt == nil {
					continue
				}
				// 学生在对方的期望同桌列表中的名次（越靠前分越高）
				if prefRank, ok := prefRankOf(st.SeatmatePref, nbSt.Name); ok {
					gain := 1.0 / float64(prefRank+1)
					// 互相心仪加成
					if _, ok2 := prefRankOf(nbSt.SeatmatePref, st.Name); ok2 {
						gain *= opt.Weights.Mutual
					}
					total += gain * float64(opt.Weights.Seatmate) / 100.0 * 2
				}
			}
		}
		// 2) 单人单桌：若期望单人，则奖励两侧无同桌（同桌=相邻有人）
		if opt.UsePref && st.SingleDesk {
			alone := true
			for _, nb := range cr.Layout.NeighborSeats(s) {
				if _, ok := idxOfNeighbor(cr, nb); ok {
					if cr.Grid[idxOfNeighborMust(cr, nb)].Student != nil {
						alone = false
						break
					}
				}
			}
			if alone {
				total += opt.Weights.Single * float64(opt.Weights.Seatmate) / 100.0 * 2
			}
		}
		// 3) 位置偏好
		if opt.UsePref && (st.RowPref != 0 || st.ColPref != 0) {
			posGain := 0.0
			if st.RowPref != 0 {
				if cr.Layout.RowZone(s.Row) == st.RowPref {
					posGain += 0.5
				} else if cr.Layout.RowZone(s.Row) == 0 {
					posGain += 0.15
				}
			}
			if st.ColPref != 0 {
				if cr.Layout.ColZone(s.Col) == st.ColPref {
					posGain += 0.5
				} else if cr.Layout.ColZone(s.Col) == 0 {
					posGain += 0.15
				}
			}
			total += posGain * float64(opt.Weights.Pos) / 100.0 * 2
		}
		// 4) 身高：高个在前排扣分
		if opt.UseHeight && st.Height > 0 {
			rowDepth := s.Row
			// 期望高个靠后：身高每超过均值一个标准差对应行，前排则扣分
			if rowDepth < cr.Layout.Rows/2 {
				total -= opt.Weights.Height * (st.Height / 100.0) * 0.5
			}
		}
	}
	return total
}

func idxOfNeighbor(cr *ClassRoom, s Seat) (int, bool) {
	for i := range cr.Grid {
		if cr.Grid[i].Seat == s {
			return i, true
		}
	}
	return 0, false
}
func idxOfNeighborMust(cr *ClassRoom, s Seat) int {
	i, _ := idxOfNeighbor(cr, s)
	return i
}

func prefRankOf(pref []string, name string) (int, bool) {
	for i, n := range pref {
		if n == name {
			return i, true
		}
	}
	return 0, false
}

// optimize 局部搜索优化：随机交换同性别学生，保留更优解。
func optimize(cr *ClassRoom, opt Options) *ClassRoom {
	best := cloneRoom(cr)
	bestScore := score(best, opt)
	cur := cloneRoom(cr)
	curScore := bestScore

	// 收集每位学生的位置
	type occ struct {
		name string
		cell *SeatCell
	}
	var occs []occ
	for i := range cur.Grid {
		if cur.Grid[i].Student != nil {
			occs = append(occs, occ{cur.Grid[i].Student.Name, &cur.Grid[i]})
		}
	}
	for it := 0; it < opt.Iterations; it++ {
		// 随机选两个同性别学生交换
		i := opt.RNG.Intn(len(occs))
		j := opt.RNG.Intn(len(occs))
		if i == j {
			continue
		}
		a, b := occs[i], occs[j]
		if a.cell.Student.Gender != b.cell.Student.Gender {
			continue
		}
		// 尝试交换
		a.cell.Student, b.cell.Student = b.cell.Student, a.cell.Student
		ns := score(cur, opt)
		if ns >= curScore {
			curScore = ns
			if ns > bestScore {
				bestScore = ns
				best = cloneRoom(cur)
			}
		} else {
			// 回退
			a.cell.Student, b.cell.Student = b.cell.Student, a.cell.Student
		}
	}
	return best
}

func cloneRoom(cr *ClassRoom) *ClassRoom {
	nc := &ClassRoom{Layout: cr.Layout, Grid: make([]SeatCell, len(cr.Grid))}
	for i := range cr.Grid {
		nc.Grid[i] = cr.Grid[i]
	}
	return nc
}
