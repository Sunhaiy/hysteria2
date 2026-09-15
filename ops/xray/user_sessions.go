package inbound

import (
	"github.com/xtls/xray-core/common/errors"
	"github.com/xtls/xray-core/common/protocol"
	"sync"
)

type userSessions struct {
	mu     sync.Mutex
	next   uint64
	active map[*protocol.MemoryUser]map[uint64]func()
}

func (h *Handler) trackUserSession(user *protocol.MemoryUser, close func()) (func(), error) {
	// Anonymous static configurations do not support API removal by email.
	if user.Email == "" {
		return func() {}, nil
	}
	h.sessions.mu.Lock()
	defer h.sessions.mu.Unlock()
	if h.validator.GetByEmail(user.Email) != user {
		close()
		return nil, errors.New("user revoked during handshake")
	}
	if h.sessions.active == nil {
		h.sessions.active = make(map[*protocol.MemoryUser]map[uint64]func())
	}
	if h.sessions.active[user] == nil {
		h.sessions.active[user] = make(map[uint64]func())
	}
	h.sessions.next++
	id := h.sessions.next
	h.sessions.active[user][id] = close
	return func() {
		h.sessions.mu.Lock()
		defer h.sessions.mu.Unlock()
		delete(h.sessions.active[user], id)
		if len(h.sessions.active[user]) == 0 {
			delete(h.sessions.active, user)
		}
	}, nil
}

