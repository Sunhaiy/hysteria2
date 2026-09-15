package main

import (
	"context"
	"errors"
	command "github.com/xtls/xray-core/app/proxyman/command"
	"google.golang.org/grpc"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type revocationHandler struct {
	command.HandlerServiceClient
	calls int
}

func (h *revocationHandler) AlterInbound(context.Context, *command.AlterInboundRequest, ...grpc.CallOption) (*command.AlterInboundResponse, error) {
	h.calls++
	return &command.AlterInboundResponse{}, nil
}
func TestKickRequiresVerifiedRunningCore(t *testing.T) {
	h := &revocationHandler{}
	a := &agent{handler: h, inboundTag: "test"}
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		a.kickUsers(r, httptest.NewRequest(http.MethodPost, "/kick", strings.NewReader(`["user"]`)))
		return r
	}
	if r := request(); r.Code != 503 || h.calls != 0 {
		t.Fatal("missing capability accepted", r.Code)
	}
	a.verifyRevocation = func(context.Context) error { return errors.New("old running binary") }
	if r := request(); r.Code != 503 || h.calls != 0 {
		t.Fatal("old running binary accepted", r.Code)
	}
	a.verifyRevocation = func(context.Context) error { return nil }
	if r := request(); r.Code != 200 || h.calls != 1 || !strings.Contains(r.Body.String(), revocationMarker) {
		t.Fatal("verified kick failed", r.Code, r.Body.String())
	}
}

