package seat

import (
"math/rand"
"testing"
)

func checkNoDup(t *testing.T, cr *ClassRoom, tag string) map[string]int {
cnt := map[string]int{}
for i := range cr.Grid {
if cr.Grid[i].Student != nil {
cnt[cr.Grid[i].Student.Name]++
}
}
for n, c := range cnt {
if c > 1 {
t.Errorf("%s: duplicate student %s x%d", tag, n, c)
}
}
return cnt
}

func TestArrangeUnique(t *testing.T) {
sts := DefaultStudents()
opt := DefaultOptions()
opt.RNG = rand.New(rand.NewSource(42))
ptrs := make([]*Student, len(sts))
for i := range sts { ptrs[i] = &sts[i] }
cr := Arrange(ptrs, DefaultLayout(), opt)
cnt := checkNoDup(t, cr, "arrange")
if len(cnt) != 43 { t.Errorf("expected 43 seated (podium 1), got %d", len(cnt)) }
}

func TestRotateModesNoLoss(t *testing.T) {
for _, mode := range []Rotation{RotRow, RotColGroup, RotColKeepGirl} {
sts := DefaultStudents()
opt := DefaultOptions()
opt.RNG = rand.New(rand.NewSource(7))
ptrs := make([]*Student, len(sts))
for i := range sts { ptrs[i] = &sts[i] }
cr := Arrange(ptrs, DefaultLayout(), opt)
before := map[string]bool{}
for i := range cr.Grid { if cr.Grid[i].Student != nil { before[cr.Grid[i].Student.Name] = true } }
nc := Rotate(cr, mode)
after := checkNoDup(t, nc, "rotate")
if len(after) != len(before) {
t.Errorf("mode %d: lost students: before=%d after=%d", mode, len(before), len(after))
}
for n := range before { if !map[string]bool{}[n] && after[n] == 0 { t.Errorf("mode %d: missing %s", mode, n) } }
}
}
