package seat

import "sort"

// Rotation 轮换模式
type Rotation int

const (
	RotRow          Rotation = iota // 前后轮换：同列内向后移一排，最后一排回最前
	RotColGroup                     // 左右大组轮换：2列一组循环右移（不保持性别列）
	RotColKeepGirl                  // 左右轮换并保持女生列结构
)

// Rotate 对现座位进行一次轮换，返回新教室。
func Rotate(cr *ClassRoom, mode Rotation) *ClassRoom {
	nc := cloneRoom(cr)
	// 记录每个学生当前座位
	cur := map[string]Seat{}
	for i := range cr.Grid {
		if cr.Grid[i].Student != nil {
			cur[cr.Grid[i].Student.Name] = cr.Grid[i].Seat
		}
	}
	next := map[string]Seat{}
	l := cr.Layout

	// 按列分组座位（只保留有座位的）
	colSeats := map[int][]Seat{}
	for _, s := range l.Seats() {
		colSeats[s.Col] = append(colSeats[s.Col], s)
	}
	for c := range colSeats {
		sort.Slice(colSeats[c], func(i, j int) bool { return colSeats[c][i].Row < colSeats[c][j].Row })
	}

	switch mode {
	case RotRow:
		// 每列内：row -> row+1，最后一排 -> 第一排
		for name, s := range cur {
			cs := colSeats[s.Col]
			idx := -1
			for i, cs2 := range cs {
				if cs2 == s {
					idx = i
					break
				}
			}
			if idx < 0 {
				next[name] = s
				continue
			}
			ni := (idx + 1) % len(cs)
			next[name] = cs[ni]
		}
	case RotColGroup:
		// 2列一组循环右移：组 [0,1]->[2,3]->[4,5]->[6,7]->[0,1]
		nb := 2 // 每组列数
		ng := l.Cols / nb
		for name, s := range cur {
			g := s.Col / nb
			ng2 := (g + 1) % ng
			nc2 := ng2*nb + (s.Col % nb)
			// 新列可能无该行的座位（旁边列少一排），就近落到该列已有座位
			if ns, ok := nearestSeat(colSeats[nc2], s.Row, true); ok {
				next[name] = ns
			} else {
				next[name] = s
			}
		}
	case RotColKeepGirl:
		// 女生只在女生列内部交换（两列互换）；男生在非女生列按2列一组轮换
		for name, s := range cur {
			st := studentOf(cr, name)
			if st != nil && st.Gender == "女" {
				// 女生列左右互换
				var other int
				for _, gc := range l.GirlCols {
					if gc != s.Col {
						other = gc
						break
					}
				}
				if ns, ok := nearestSeat(colSeats[other], s.Row, true); ok {
					next[name] = ns
				} else {
					next[name] = s
				}
			} else {
				// 男生列按2列一组轮换（跳过女生列）
				var boyCols []int
				for c := 0; c < l.Cols; c++ {
					if !l.IsGirlCol(c) {
						boyCols = append(boyCols, c)
					}
				}
				idx := -1
				for i, c := range boyCols {
					if c == s.Col {
						idx = i
						break
					}
				}
				if idx < 0 {
					next[name] = s
					continue
				}
				nidx := (idx + 2) % len(boyCols) // 男生列每2列一组
				if ns, ok := nearestSeat(colSeats[boyCols[nidx]], s.Row, true); ok {
					next[name] = ns
				} else {
					next[name] = s
				}
			}
		}
	}

	// 应用新座位（保留原有 Student 指针）
	occupied := map[Seat]bool{}
	for name, ns := range next {
		for i := range nc.Grid {
			if nc.Grid[i].Seat == ns && !occupied[ns] {
				nc.Grid[i].Student = studentOf(cr, name)
				nc.Grid[i].Empty = false
				occupied[ns] = true
				break
			}
		}
	}
	return nc
}

func studentOf(cr *ClassRoom, name string) *Student {
	for i := range cr.Grid {
		if cr.Grid[i].Student != nil && cr.Grid[i].Student.Name == name {
			return cr.Grid[i].Student
		}
	}
	return nil
}

// nearestSeat 在目标列中找到与目标行最接近的座位；ok=false 表示无可用座位。
func nearestSeat(seats []Seat, row int, must bool) (Seat, bool) {
	if len(seats) == 0 {
		return Seat{}, false
	}
	best := seats[0]
	bd := absInt(seats[0].Row - row)
	for _, s := range seats {
		if d := absInt(s.Row - row); d < bd {
			bd = d
			best = s
		}
	}
	return best, true
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
