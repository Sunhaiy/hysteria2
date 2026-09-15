package inbound

import (
	"context"
	"github.com/xtls/xray-core/common/protocol"
	"github.com/xtls/xray-core/common/uuid"
	"github.com/xtls/xray-core/proxy/vless"
	"net"
	"testing"
	"time"
)

func testUser(email string) *protocol.MemoryUser {
	return &protocol.MemoryUser{Email: email, Account: &vless.MemoryAccount{ID: protocol.NewID(uuid.New())}}
}

func TestRemoveUserClosesOnlyTheirLiveStreams(t *testing.T) {
	h := &Handler{validator: &vless.MemoryValidator{}}
	a, b := testUser("a"), testUser("b")
	ctx := context.Background()
	if err := h.AddUser(ctx, a); err != nil {
		t.Fatal(err)
	}
	if err := h.AddUser(ctx, b); err != nil {
		t.Fatal(err)
	}
	left, right := net.Pipe()
	defer right.Close()
	cancelCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	release, err := h.trackUserSession(a, func() { cancel(); left.Close() })
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	bClosed := false
	releaseB, err := h.trackUserSession(b, func() { bClosed = true })
	if err != nil {
		t.Fatal(err)
	}
	defer releaseB()
	if err := h.RemoveUser(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	right.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := right.Read(make([]byte, 1)); err == nil {
		t.Fatal("revoked stream still readable")
	}
	if cancelCtx.Err() == nil {
		t.Fatal("outbound context not canceled")
	}
	if bClosed || h.validator.GetByEmail("b") == nil {
		t.Fatal("other user affected")
	}
	replacement := testUser("a")
	if err := h.AddUser(ctx, replacement); err != nil {
		t.Fatal(err)
	}
	staleClosed := false
	if _, err := h.trackUserSession(a, func() { staleClosed = true }); err == nil || !staleClosed {
		t.Fatal("stale handshake accepted")
	}
	currentClosed := false
	done, err := h.trackUserSession(replacement, func() { currentClosed = true })
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	release() // cleanup of the revoked generation must not remove the new one
	if currentClosed {
		t.Fatal("replacement disconnected")
	}
	if err := h.RemoveUser(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	if !currentClosed {
		t.Fatal("replacement stream not tracked")
	}
}

