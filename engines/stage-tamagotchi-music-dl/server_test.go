package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/guohuiyuan/go-music-dl/core"
	"github.com/guohuiyuan/music-lib/model"
)

func TestMusicServerRequiresBearerToken(t *testing.T) {
	handler := newMusicServer("secret", 43123).routes()

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/v1/health", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("GET /v1/health status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	authorizedRequest := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	authorizedRequest.Header.Set("Authorization", "Bearer secret")
	authorized := httptest.NewRecorder()
	handler.ServeHTTP(authorized, authorizedRequest)
	if authorized.Code != http.StatusOK {
		t.Fatalf("GET /v1/health status = %d, want %d", authorized.Code, http.StatusOK)
	}
}

func TestMusicServerReturnsFixedLoopbackStreamURL(t *testing.T) {
	server := newMusicServer("secret", 43123)
	server.resolver = &musicResolver{
		sources: []string{"test"},
		search: func(_ context.Context, _ string, _ string) ([]model.Song, error) {
			return []model.Song{{
				ID:       "track-id",
				Name:     "Test Song",
				Artist:   "Test Artist",
				Album:    "Test Album",
				Duration: 123,
				Cover:    "https://example.com/cover.jpg",
			}}, nil
		},
		validate: func(_ context.Context, _ model.Song) bool { return true },
	}

	request := httptest.NewRequest(http.MethodPost, "http://malicious.example/v1/resolve", strings.NewReader(`{"query":"Test Song"}`))
	request.Header.Set("Authorization", "Bearer secret")
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("POST /v1/resolve status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}

	var payload resolveResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	streamURL, err := url.Parse(payload.StreamURL)
	if err != nil {
		t.Fatalf("parse stream URL: %v", err)
	}
	if streamURL.Host != "127.0.0.1:43123" {
		t.Fatalf("stream URL host = %q, want %q", streamURL.Host, "127.0.0.1:43123")
	}
	if streamURL.Query().Get("token") != "secret" {
		t.Fatalf("stream URL token = %q, want secret", streamURL.Query().Get("token"))
	}
	if !strings.HasPrefix(streamURL.Path, "/v1/tracks/") || !strings.HasSuffix(streamURL.Path, "/audio") {
		t.Fatalf("stream URL path = %q, want track audio path", streamURL.Path)
	}
}

func TestMusicServerRejectsInvalidAudioTokenBeforeLookup(t *testing.T) {
	server := newMusicServer("secret", 43123)
	server.storeTrack("track", model.Song{ID: "track", Source: "test"})

	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/tracks/track/audio?token=wrong", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("GET audio status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestMusicServerQRLoginLifecycle(t *testing.T) {
	server := newMusicServer("secret", 43123)
	savedCookies := map[string]string{}
	server.qrLoginCreate = func(source string) core.QRLoginCreateFunc {
		if source != "netease" && source != "qq_wx" {
			return nil
		}
		return func() (*model.QRLoginSession, error) {
			return &model.QRLoginSession{Source: source, Key: "login-key", URL: "https://example.com/qr", ExpiresAt: 123}, nil
		}
	}
	server.qrLoginCheck = func(source string) core.QRLoginCheckFunc {
		if source != "netease" && source != "qq_wx" {
			return nil
		}
		return func(key string) (*model.QRLoginResult, error) {
			if key != "login-key" {
				return &model.QRLoginResult{Status: model.QRLoginStatusExpired}, nil
			}
			return &model.QRLoginResult{Status: model.QRLoginStatusSuccess, Cookie: "MUSIC_U=abc"}, nil
		}
	}
	server.setCookie = func(source string, value string) {
		if value == "" {
			delete(savedCookies, source)
			return
		}
		savedCookies[source] = value
	}
	server.cookieSources = func() map[string]string { return savedCookies }
	handler := server.routes()

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/v1/login/status", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("GET login status without token = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}

	createRequest := httptest.NewRequest(http.MethodPost, "/v1/login/qr", strings.NewReader(`{"source":"netease"}`))
	createRequest.Header.Set("Authorization", "Bearer secret")
	created := httptest.NewRecorder()
	handler.ServeHTTP(created, createRequest)
	if created.Code != http.StatusOK {
		t.Fatalf("POST login qr = %d, want %d; body = %s", created.Code, http.StatusOK, created.Body.String())
	}
	var session qrLoginSessionResponse
	if err := json.NewDecoder(created.Body).Decode(&session); err != nil {
		t.Fatalf("decode session: %v", err)
	}
	if session.Key != "login-key" || session.URL != "https://example.com/qr" {
		t.Fatalf("session = %#v, want fake login session", session)
	}

	unsupportedRequest := httptest.NewRequest(http.MethodPost, "/v1/login/qr", strings.NewReader(`{"source":"migu"}`))
	unsupportedRequest.Header.Set("Authorization", "Bearer secret")
	unsupported := httptest.NewRecorder()
	handler.ServeHTTP(unsupported, unsupportedRequest)
	if unsupported.Code != http.StatusNotFound {
		t.Fatalf("POST login qr unsupported = %d, want %d", unsupported.Code, http.StatusNotFound)
	}

	// The WeChat scan flow must save its cookie under the qq source, which is
	// the source that later search and download calls read.
	checkRequest := httptest.NewRequest(http.MethodGet, "/v1/login/qr/qq_wx?key=login-key", nil)
	checkRequest.Header.Set("Authorization", "Bearer secret")
	checked := httptest.NewRecorder()
	handler.ServeHTTP(checked, checkRequest)
	if checked.Code != http.StatusOK {
		t.Fatalf("GET login qr check = %d, want %d; body = %s", checked.Code, http.StatusOK, checked.Body.String())
	}
	var checkPayload qrLoginCheckResponse
	if err := json.NewDecoder(checked.Body).Decode(&checkPayload); err != nil {
		t.Fatalf("decode check payload: %v", err)
	}
	if checkPayload.Status != string(model.QRLoginStatusSuccess) || !checkPayload.CookieSaved {
		t.Fatalf("check payload = %#v, want saved success", checkPayload)
	}
	if savedCookies["qq"] != "MUSIC_U=abc" {
		t.Fatalf("saved cookies = %#v, want qq_wx cookie stored under qq", savedCookies)
	}

	statusRequest := httptest.NewRequest(http.MethodGet, "/v1/login/status", nil)
	statusRequest.Header.Set("Authorization", "Bearer secret")
	status := httptest.NewRecorder()
	handler.ServeHTTP(status, statusRequest)
	var statusPayload loginStatusResponse
	if err := json.NewDecoder(status.Body).Decode(&statusPayload); err != nil {
		t.Fatalf("decode status payload: %v", err)
	}
	if !statusPayload.Sources["qq"] {
		t.Fatalf("status payload = %#v, want qq signed in", statusPayload)
	}

	clearRequest := httptest.NewRequest(http.MethodDelete, "/v1/login/qq", nil)
	clearRequest.Header.Set("Authorization", "Bearer secret")
	cleared := httptest.NewRecorder()
	handler.ServeHTTP(cleared, clearRequest)
	if cleared.Code != http.StatusOK {
		t.Fatalf("DELETE login = %d, want %d", cleared.Code, http.StatusOK)
	}
	var clearedPayload loginStatusResponse
	if err := json.NewDecoder(cleared.Body).Decode(&clearedPayload); err != nil {
		t.Fatalf("decode cleared payload: %v", err)
	}
	if clearedPayload.Sources["qq"] {
		t.Fatalf("cleared payload = %#v, want qq signed out", clearedPayload)
	}
	if _, ok := savedCookies["qq"]; ok {
		t.Fatalf("saved cookies = %#v, want qq removed", savedCookies)
	}
}

func TestMusicServerReusesResolvedStreamURLAcrossAudioRequests(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "audio/mpeg")
		_, _ = response.Write([]byte("audio-bytes"))
	}))
	defer upstream.Close()

	server := newMusicServer("secret", 43123)
	downloads := 0
	server.download = func(_ string) func(*model.Song) (string, error) {
		return func(*model.Song) (string, error) {
			downloads++
			return upstream.URL, nil
		}
	}
	server.storeTrack("track", model.Song{ID: "track", Source: "test"})

	// ROOT CAUSE:
	//
	// The audio handler resolved the source download URL again on every
	// request. One playback session issues many range requests, so the
	// provider's URL API was hit once per request; its intermittent failures
	// surfaced as mid-song 502s that aborted playback, and URL rotation broke
	// Content-Range totals between requests.
	//
	// We fixed this by caching the resolved URL per track and reusing it for
	// every audio request within its lifetime.
	for attempt := 1; attempt <= 2; attempt++ {
		response := httptest.NewRecorder()
		server.routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/tracks/track/audio?token=secret", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("GET audio #%d status = %d, want %d; body = %s", attempt, response.Code, http.StatusOK, response.Body.String())
		}
		if response.Body.String() != "audio-bytes" {
			t.Fatalf("GET audio #%d body = %q, want audio bytes", attempt, response.Body.String())
		}
	}
	if downloads != 1 {
		t.Fatalf("download resolutions = %d, want 1 (cached URL should be reused)", downloads)
	}
}

func TestMusicServerRetriesWithFreshURLWhenUpstreamFails(t *testing.T) {
	stale := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusForbidden)
	}))
	defer stale.Close()
	fresh := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "audio/mpeg")
		_, _ = response.Write([]byte("audio-bytes"))
	}))
	defer fresh.Close()

	server := newMusicServer("secret", 43123)
	downloads := 0
	server.download = func(_ string) func(*model.Song) (string, error) {
		return func(*model.Song) (string, error) {
			downloads++
			if downloads == 1 {
				return stale.URL, nil
			}
			return fresh.URL, nil
		}
	}
	server.storeTrack("track", model.Song{ID: "track", Source: "test"})

	// ROOT CAUSE:
	//
	// When the upstream rejected a request (stale or throttled CDN URL), the
	// handler proxied the error status straight to the audio element, which
	// aborted playback. A fresh URL resolution usually succeeds, so the
	// handler must retry once before it reports 502.
	response := httptest.NewRecorder()
	server.routes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/tracks/track/audio?token=secret", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("GET audio status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	if response.Body.String() != "audio-bytes" {
		t.Fatalf("GET audio body = %q, want audio bytes", response.Body.String())
	}
	if downloads != 2 {
		t.Fatalf("download resolutions = %d, want 2 (failed URL should refresh once)", downloads)
	}
}
