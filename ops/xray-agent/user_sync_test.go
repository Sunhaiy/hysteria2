package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	command "github.com/xtls/xray-core/app/proxyman/command"
	"github.com/xtls/xray-core/common/protocol"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/proxy/vless"
	"google.golang.org/grpc"
)

const oldUUID = "11111111-1111-4111-8111-111111111111"
const newUUID = "22222222-2222-4222-8222-222222222222"

type syncHandler struct {
	command.HandlerServiceClient
	users   map[string]*vless.Account
	calls   []string
	failAdd bool
}

func (h *syncHandler) GetInboundUsers(context.Context, *command.GetInboundUserRequest, ...grpc.CallOption) (*command.GetInboundUserResponse, error) {
	r := &command.GetInboundUserResponse{}
	for email, account := range h.users {
		r.Users = append(r.Users, &protocol.User{Email: email, Account: serial.ToTypedMessage(account)})
	}
	return r, nil
}

func (h *syncHandler) AlterInbound(_ context.Context, req *command.AlterInboundRequest, _ ...grpc.CallOption) (*command.AlterInboundResponse, error) {
	op, err := req.Operation.GetInstance()
	if err != nil {
		return nil, err
	}
	switch op := op.(type) {
	case *command.RemoveUserOperation:
		h.calls = append(h.calls, "remove:"+op.Email)
		delete(h.users, op.Email)
	case *command.AddUserOperation:
		h.calls = append(h.calls, "add:"+op.User.Email)
		if h.failAdd {
			return nil, errors.New("transient add failure")
		}
		account, err := op.User.Account.GetInstance()
		if err != nil {
			return nil, err
		}
		h.users[op.User.Email] = account.(*vless.Account)
	}
	return &command.AlterInboundResponse{}, nil
}

func runUserSync(a *agent, users []provisionedUser) *httptest.ResponseRecorder {
	body, _ := json.Marshal(users)
	w := httptest.NewRecorder()
	a.syncUsers(w, httptest.NewRequest(http.MethodPost, "/users", strings.NewReader(string(body))))
	return w
}

func TestSyncRotatedCredentialWithoutTouchingOtherUsers(t *testing.T) {
	h := &syncHandler{users: map[string]*vless.Account{
		"rotated":   {Id: oldUUID, Flow: "xtls-rprx-vision"},
		"unchanged": {Id: oldUUID, Flow: "xtls-rprx-vision"},
	}}
	a := &agent{handler: h, verifyRevocation: func(context.Context) error { return nil }}
	desired := []provisionedUser{{Email: "rotated", ID: newUUID}, {Email: "unchanged", ID: oldUUID}}
	if w := runUserSync(a, desired); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if h.users["rotated"].Id != newUUID || strings.Join(h.calls, ",") != "remove:rotated,add:rotated" {
		t.Fatal("rotation did not replace only the changed account", h.calls)
	}
	h.calls = nil
	if w := runUserSync(a, desired); w.Code != 200 || len(h.calls) != 0 {
		t.Fatal("repeat sync changed existing sessions", h.calls)
	}
}

func TestSyncCredentialValidationPrecedesAnyRemoval(t *testing.T) {
	for _, bad := range []provisionedUser{{Email: "rotated", ID: "not-a-uuid"}, {Email: "rotated", ID: newUUID, Flow: "invalid"}} {
		h := &syncHandler{users: map[string]*vless.Account{"rotated": {Id: oldUUID}}}
		a := &agent{handler: h, verifyRevocation: func(context.Context) error { return nil }}
		if w := runUserSync(a, []provisionedUser{bad}); w.Code != 400 || len(h.calls) != 0 {
			t.Fatal("invalid payload mutated users", w.Code, h.calls)
		}
	}
}

func TestSyncRotationRequiresRevocationAndRecoversFailedAdd(t *testing.T) {
	h := &syncHandler{users: map[string]*vless.Account{"rotated": {Id: oldUUID, Flow: "xtls-rprx-vision"}}}
	a := &agent{handler: h}
	desired := []provisionedUser{{Email: "rotated", ID: newUUID}}
	if w := runUserSync(a, desired); w.Code != 503 || len(h.calls) != 0 {
		t.Fatal("unverified removal", w.Code, h.calls)
	}
	a.verifyRevocation = func(context.Context) error { return nil }
	h.failAdd = true
	if w := runUserSync(a, desired); w.Code == 200 {
		t.Fatal("failed update reported success")
	}
	h.failAdd = false
	if w := runUserSync(a, desired); w.Code != 200 || h.users["rotated"].Id != newUUID {
		t.Fatal("retry failed", w.Code)
	}
}

func TestSyncFlowChangeReplacesOnlyChangedAccount(t *testing.T) {
	h := &syncHandler{users: map[string]*vless.Account{"flow": {Id: oldUUID}}}
	a := &agent{handler: h, verifyRevocation: func(context.Context) error { return nil }}
	if w := runUserSync(a, []provisionedUser{{Email: "flow", ID: oldUUID}}); w.Code != 200 || h.users["flow"].Flow != "xtls-rprx-vision" {
		t.Fatal("flow update failed", w.Code)
	}
}
