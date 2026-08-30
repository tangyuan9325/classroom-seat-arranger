package seat

import (
	"bytes"
	"io"

	"github.com/xuri/excelize/v2"
)

// openXLSX 打开 xlsx 流。
func openXLSX(r io.Reader) (*excelize.File, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	return excelize.OpenReader(bytes.NewReader(data))
}
