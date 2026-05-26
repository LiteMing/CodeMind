package collab

import "time"

func deadline() time.Time {
	return time.Now().Add(writeWait)
}
