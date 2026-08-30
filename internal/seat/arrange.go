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

// Arrange 生成一份座位安排（遵守固定座位规则）。
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

// colSeatsOf 按列分座。
func colSeatsOf(layout Layout) (map[int][]Seat, []int) {
	colMap := map[int][]Seat{}
	for _, s := range layout.Seats() {
		colMap[s.Col] = append(colMap[s.Col], s)
	}
	for c := range colMap {
		sort.Slice(colMap[c], func(i, j int) bool { return colMap[c][i].Row < colMap[c][j].Row })
	}
	// 稳定列顺序：女生列优先
	seen := map[int]bool{}
	var order []int
	for _, c := range layout.GirlCols {
		order = append(order, c)
		seen[c] = true
	}
	for c := 0; c < layout.Cols; c++ {
		if !seen[c] {
			order = append(order, c)
		}
	}
	return colMap, order
}

// buildInitial 构造一个初始可行解：女生入女生列（遵守固定同桌/单人），男生入其余列。
func buildInitial(sts []*Student, layout Layout, opt Options) *ClassRoom {
	fixed := layout.Fixed
	colMap, order := colSeatsOf(layout)

	// 1) 取出讲台旁学生
	var podium *Student
	pool := make([]*Student, 0, len(sts))
	for i := range sts {
		if fixed.PodiumSeat != "" && sts[i].Name == fixed.PodiumSeat {
			podium = sts[i]
		} else {
			pool = append(pool, sts[i])
		}
	}

	// 2) 性别分组
	var girls, boys []*Student
	for i := range pool {
		if pool[i].Gender == "女" {
			girls = append(girls, pool[i])
		} else {
			boys = append(boys, pool[i])
		}
	}

	// 3) 女生配对/单人
	//    固定同桌 + 其余按偏好/身高配对；单人（Alone）单独一列
	fixedPairSet := map[string]string{} // name -> partner
	for _, p := range fixed.FixedPairs {
		if len(p) == 2 {
			fixedPairSet[p[0]] = p[1]
			fixedPairSet[p[1]] = p[0]
		}
	}
	aloneSet := map[string]bool{}
	for _, n := range fixed.Alone {
		aloneSet[n] = true
	}

	// 女生列座位：两列对应行 = 一个同桌组
	girlSeatRows := pairRowsOf(layout, colMap)

	// 需要占用的行：成对占1行，单人占1行
	type girlSlot struct {
		members []*Student // 成对2人或单人1人
		alone   bool
	}
	var slots []girlSlot
	used := map[string]bool{}
	// 固定同桌
	for _, p := range fixed.FixedPairs {
		var pair []*Student
		for _, n := range p {
			if st := findStudent(girls, n); st != nil {
				pair = append(pair, st)
				used[n] = true
			}
		}
		if len(pair) >= 1 {
			slots = append(slots, girlSlot{members: pair, alone: len(pair) == 1})
		}
	}
	// 单人
	for _, n := range fixed.Alone {
		if st := findStudent(girls, n); st != nil && !used[n] {
			slots = append(slots, girlSlot{members: []*Student{st}, alone: true})
			used[n] = true
		}
	}
	// 其余女生按偏好配对
	var rest []*Student
	for i := range girls {
		if !used[girls[i].Name] {
			rest = append(rest, girls[i])
		}
	}
	if opt.Randomize {
		Shuffle(rest, opt.RNG)
	} else if opt.UsePref {
		rest = pairByPref(rest)
	} else if opt.UseHeight {
		sort.SliceStable(rest, func(i, j int) bool {
			a, b := rest[i].Height, rest[j].Height
			if a == b {
				return false
			}
			return a < b
		})
	}
	for i := 0; i < len(rest); i += 2 {
		m := []*Student{rest[i]}
		if i+1 < len(rest) {
			m = append(m, rest[i+1])
		}
		slots = append(slots, girlSlot{members: m, alone: len(m) == 1})
	}

	// 4) 分配女生座位
	assign := map[string]Seat{} // name -> seat
	usedSeat := map[Seat]bool{}
	// girlSeatRows 每行：{colA, colB}
	usedGirlRows := 0
	for _, slot := range slots {
		if usedGirlRows >= len(girlSeatRows) {
			break
		}
		row := girlSeatRows[usedGirlRows]
		usedGirlRows++
		// 成对：放两列；单人：放第一列，第二列留空（预留空位，防止男生补入）
		if slot.alone {
			assign[slot.members[0].Name] = Seat{Row: row.row, Col: row.colA}
			usedSeat[Seat{Row: row.row, Col: row.colA}] = true
			// 同桌位留空：标记为已用（空），不让其他学生坐进来
			usedSeat[Seat{Row: row.row, Col: row.colB}] = true
		} else {
			for i, m := range slot.members {
				c := row.colA
				if i == 1 {
					c = row.colB
				}
				assign[m.Name] = Seat{Row: row.row, Col: c}
				usedSeat[Seat{Row: row.row, Col: c}] = true
			}
		}
	}

	// 5) 男生放入其余座位（含女生列剩余空位）
	var restSeats []Seat
	for _, c := range order {
		for _, s := range colMap[c] {
			if !usedSeat[s] {
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
		assign[ordered[i].Name] = s
		usedSeat[s] = true
	}

	// 6) 组装网格
	cr := &ClassRoom{Layout: layout}
	for _, s := range layout.Seats() {
		cell := SeatCell{Seat: s, Empty: true}
		cell.IsMiddle = layout.IsMiddleCol(s.Col)
		cell.IsGirlCol = layout.IsGirlCol(s.Col)
		cr.Grid = append(cr.Grid, cell)
	}
	for name, seat := range assign {
		for i := range cr.Grid {
			if cr.Grid[i].Seat == seat {
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
	// 讲台旁座位
	if podium != nil {
		cr.Podium = []SeatCell{{
			Seat:    Seat{Row: 0, Col: -1}, // 特殊标记
			Student: podium,
			Empty:   false,
		}}
	}
	return cr
}

// pairRowsOf 女生列可用的成对行（每行两列都有座）。
type girlRow struct {
	row  int
	colA int
	colB int
}

func pairRowsOf(layout Layout, colMap map[int][]Seat) []girlRow {
	if len(layout.GirlCols) < 2 {
		return nil
	}
	colA, colB := layout.GirlCols[0], layout.GirlCols[1]
	seatsA := map[int]bool{}
	for _, s := range colMap[colA] {
		seatsA[s.Row] = true
	}
	seatsB := map[int]bool{}
	for _, s := range colMap[colB] {
		seatsB[s.Row] = true
	}
	var out []girlRow
	for r := 0; r < layout.Rows; r++ {
		if seatsA[r] && seatsB[r] {
			out = append(out, girlRow{row: r, colA: colA, colB: colB})
		}
	}
	return out
}

func findStudent(sts []*Student, name string) *Student {
	for i := range sts {
		if sts[i].Name == name {
			return sts[i]
		}
	}
	return nil
}

// pairByPref 按期望同桌互选贪心配对。
func pairByPref(sts []*Student) []*Student {
	idx := map[string]int{}
	for i := range sts {
		idx[sts[i].Name] = i
	}
	paired := map[string]bool{}
	var order []*Student
	for i := range sts {
		if paired[sts[i].Name] {
			continue
		}
		order = append(order, sts[i])
		// 找最佳配对
		best := -1
		if opt := sts[i].SeatmatePref; len(opt) > 0 {
			for _, n := range opt {
				if j, ok := idx[n]; ok && !paired[n] && j != i {
					// 检查互选
					recip := false
					for _, n2 := range sts[j].SeatmatePref {
						if n2 == sts[i].Name {
							recip = true
							break
						}
					}
					if recip || true {
						best = j
						break
					}
				}
			}
		}
		if best >= 0 {
			order = append(order, sts[best])
			paired[sts[best].Name] = true
		}
		paired[sts[i].Name] = true
	}
	return order
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
				if prefRank, ok := prefRankOf(st.SeatmatePref, nbSt.Name); ok {
					gain := 1.0 / float64(prefRank+1)
					if _, ok2 := prefRankOf(nbSt.SeatmatePref, st.Name); ok2 {
						gain *= opt.Weights.Mutual
					}
					total += gain * float64(opt.Weights.Seatmate) / 100.0 * 2
				}
			}
		}
		// 2) 单人单桌：两侧无同桌奖励
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
// 讲台旁座位学生不参与交换。
func optimize(cr *ClassRoom, opt Options) *ClassRoom {
	best := cloneRoom(cr)
	bestScore := score(best, opt)
	cur := cloneRoom(cr)
	curScore := bestScore

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
		i := opt.RNG.Intn(len(occs))
		j := opt.RNG.Intn(len(occs))
		if i == j {
			continue
		}
		a, b := occs[i], occs[j]
		if a.cell.Student.Gender != b.cell.Student.Gender {
			continue
		}
		a.cell.Student, b.cell.Student = b.cell.Student, a.cell.Student
		ns := score(cur, opt)
		if ns >= curScore {
			curScore = ns
			if ns > bestScore {
				bestScore = ns
				best = cloneRoom(cur)
			}
		} else {
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
	nc.Podium = append([]SeatCell{}, cr.Podium...)
	return nc
}
