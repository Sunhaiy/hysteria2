package main

import (
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestMissingUserErrorsAreIdempotent(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "canonical not found",
			err:  status.Error(codes.NotFound, "user not found"),
			want: true,
		},
		{
			name: "xray unknown not found",
			err: status.Error(
				codes.Unknown,
				"proxy/vless: User user_1 not found.",
			),
			want: true,
		},
		{
			name: "other xray failure",
			err:  status.Error(codes.Unknown, "handler unavailable"),
			want: false,
		},
		{
			name: "non grpc failure",
			err:  errors.New("network unavailable"),
			want: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isMissingUserError(test.err); got != test.want {
				t.Fatalf("isMissingUserError() = %v, want %v", got, test.want)
			}
		})
	}
}
