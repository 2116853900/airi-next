package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/guohuiyuan/go-music-dl/core"
	"github.com/guohuiyuan/music-lib/model"
)

const (
	maxQueryBytes     = 400
	trackLifetime     = 6 * time.Hour
	maxStoredTracks   = 100
	responseBodyLimit = 4 << 10
	// One resolved upstream URL is reused for every audio request of a track
	// within this window. Source CDN URLs stay valid well beyond it, and one
	// playback session re-requests the same track many times.
	streamURLLifetime = 5 * time.Minute
)

type musicServer struct {
	token    string
	port     int
	resolver *musicResolver
	// download resolves a source name to its URL resolver; injectable in tests.
	download func(source string) func(*model.Song) (string, error)
	// QR login and cookie persistence go through go-music-dl globals in
	// production; injectable in tests so no real platform API or SQLite file
	// is touched.
	qrLoginCreate func(source string) core.QRLoginCreateFunc
	qrLoginCheck  func(source string) core.QRLoginCheckFunc
	setCookie     func(source string, value string)
	cookieSources func() map[string]string
	tracks        map[string]storedTrack
	// streamURLs caches the resolved upstream URL per track id; guarded by
	// trackMu together with tracks so both maps evict in step.
	streamURLs map[string]cachedStreamURL
	trackMu    sync.Mutex
}

type resolveRequest struct {
	Query string `json:"query"`
}

type resolveResponse struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album,omitempty"`
	DurationMs int    `json:"durationMs,omitempty"`
	Source     string `json:"source"`
	CoverURL   string `json:"coverUrl,omitempty"`
	StreamURL  string `json:"streamUrl"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type storedTrack struct {
	song      model.Song
	createdAt time.Time
}

type cachedStreamURL struct {
	url        string
	resolvedAt time.Time
}

func newMusicServer(token string, port int) *musicServer {
	return &musicServer{
		token:         token,
		port:          port,
		resolver:      newMusicResolver(),
		download:      core.GetDownloadFunc,
		qrLoginCreate: core.GetQRLoginCreateFunc,
		qrLoginCheck:  core.GetQRLoginCheckFunc,
		setCookie: func(source string, value string) {
			// SetAll deletes the entry when value is empty, so sign-out and
			// sign-in share one persistence path.
			core.CM.SetAll(map[string]string{source: value})
			core.CM.Save()
		},
		cookieSources: core.CM.GetAll,
		tracks:        make(map[string]storedTrack),
		streamURLs:    make(map[string]cachedStreamURL),
	}
}

func (server *musicServer) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", server.requireBearer(server.handleHealth))
	mux.HandleFunc("POST /v1/resolve", server.requireBearer(server.handleResolve))
	mux.HandleFunc("POST /v1/login/qr", server.requireBearer(server.handleLoginQrCreate))
	mux.HandleFunc("GET /v1/login/qr/{source}", server.requireBearer(server.handleLoginQrCheck))
	mux.HandleFunc("GET /v1/login/status", server.requireBearer(server.handleLoginStatus))
	mux.HandleFunc("DELETE /v1/login/{source}", server.requireBearer(server.handleLoginClear))
	mux.HandleFunc("GET /v1/tracks/{trackID}/audio", server.handleAudio)
	mux.HandleFunc("HEAD /v1/tracks/{trackID}/audio", server.handleAudio)
	return mux
}

func (server *musicServer) requireBearer(next http.HandlerFunc) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		provided := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
		if !server.matchesToken(provided) {
			writeJSON(response, http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
			return
		}
		next(response, request)
	}
}

func (server *musicServer) matchesToken(provided string) bool {
	if len(provided) != len(server.token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(server.token)) == 1
}

func (server *musicServer) handleHealth(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
}

func (server *musicServer) handleResolve(response http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(response, request.Body, responseBodyLimit)
	var input resolveRequest
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(response, http.StatusBadRequest, errorResponse{Error: "invalid request"})
		return
	}

	query := strings.TrimSpace(input.Query)
	if query == "" {
		writeJSON(response, http.StatusBadRequest, errorResponse{Error: "query is required"})
		return
	}
	if !utf8.ValidString(query) || len(query) > maxQueryBytes {
		writeJSON(response, http.StatusBadRequest, errorResponse{Error: "query is too long"})
		return
	}

	song, err := server.resolver.resolve(request.Context(), query)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, errNoPlayableTrack) {
			status = http.StatusNotFound
		}
		writeJSON(response, status, errorResponse{Error: err.Error()})
		return
	}

	trackID, err := randomID()
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, errorResponse{Error: "failed to create track id"})
		return
	}
	server.storeTrack(trackID, song)
	streamURL := fmt.Sprintf(
		"http://127.0.0.1:%d/v1/tracks/%s/audio?token=%s",
		server.port,
		trackID,
		server.token,
	)
	writeJSON(response, http.StatusOK, resolveResponse{
		ID:         song.ID,
		Title:      song.Name,
		Artist:     song.Artist,
		Album:      song.Album,
		DurationMs: song.Duration * 1000,
		Source:     song.Source,
		CoverURL:   song.Cover,
		StreamURL:  streamURL,
	})
}

type qrLoginCreateRequest struct {
	Source string `json:"source"`
}

type qrLoginSessionResponse struct {
	Source string `json:"source"`
	Key    string `json:"key"`
	// URL is the QR payload the client renders locally; some sources return
	// a ready-made image instead.
	URL       string `json:"url,omitempty"`
	ImageURL  string `json:"imageUrl,omitempty"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
}

type qrLoginCheckResponse struct {
	Status      string `json:"status"`
	Message     string `json:"message,omitempty"`
	CookieSaved bool   `json:"cookieSaved,omitempty"`
}

type loginStatusResponse struct {
	// Sources maps a source name to whether an account cookie is saved.
	// Cookie values never leave the sidecar.
	Sources map[string]bool `json:"sources"`
}

// qrLoginCookieString mirrors go-music-dl's web UI: prefer the ready-made
// cookie string, otherwise join the cookie pairs deterministically.
func qrLoginCookieString(result *model.QRLoginResult) string {
	if result == nil {
		return ""
	}
	if cookie := strings.TrimSpace(result.Cookie); cookie != "" {
		return cookie
	}
	keys := make([]string, 0, len(result.Cookies))
	for key := range result.Cookies {
		if strings.TrimSpace(key) != "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		if value := strings.TrimSpace(result.Cookies[key]); value != "" {
			parts = append(parts, key+"="+value)
		}
	}
	return strings.Join(parts, "; ")
}

// qrLoginCookieSource maps a login flow to the source that consumes its
// cookie: the WeChat scan signs into the same QQ Music account.
func qrLoginCookieSource(source string) string {
	if source == "qq_wx" {
		return "qq"
	}
	return source
}

func (server *musicServer) handleLoginQrCreate(response http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(response, request.Body, responseBodyLimit)
	var input qrLoginCreateRequest
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(response, http.StatusBadRequest, errorResponse{Error: "invalid request"})
		return
	}

	source := strings.TrimSpace(input.Source)
	create := server.qrLoginCreate(source)
	if create == nil {
		writeJSON(response, http.StatusNotFound, errorResponse{Error: "source does not support qr login"})
		return
	}
	session, err := create()
	if err != nil || session == nil {
		writeJSON(response, http.StatusBadGateway, errorResponse{Error: "failed to create login session"})
		return
	}

	writeJSON(response, http.StatusOK, qrLoginSessionResponse{
		Source:    source,
		Key:       session.Key,
		URL:       session.URL,
		ImageURL:  session.ImageURL,
		ExpiresAt: session.ExpiresAt,
	})
}

func (server *musicServer) handleLoginQrCheck(response http.ResponseWriter, request *http.Request) {
	source := strings.TrimSpace(request.PathValue("source"))
	key := strings.TrimSpace(request.URL.Query().Get("key"))
	if key == "" {
		writeJSON(response, http.StatusBadRequest, errorResponse{Error: "missing login key"})
		return
	}
	check := server.qrLoginCheck(source)
	if check == nil {
		writeJSON(response, http.StatusNotFound, errorResponse{Error: "source does not support qr login"})
		return
	}
	result, err := check(key)
	if err != nil || result == nil {
		writeJSON(response, http.StatusBadGateway, errorResponse{Error: "login check failed"})
		return
	}

	payload := qrLoginCheckResponse{Status: string(result.Status), Message: result.Message}
	if result.Status == model.QRLoginStatusSuccess {
		if cookie := qrLoginCookieString(result); cookie != "" {
			server.setCookie(qrLoginCookieSource(source), cookie)
			payload.CookieSaved = true
		}
	}
	writeJSON(response, http.StatusOK, payload)
}

func (server *musicServer) handleLoginStatus(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, server.loginStatus())
}

func (server *musicServer) handleLoginClear(response http.ResponseWriter, request *http.Request) {
	source := strings.TrimSpace(request.PathValue("source"))
	if source == "" {
		writeJSON(response, http.StatusBadRequest, errorResponse{Error: "missing source"})
		return
	}
	server.setCookie(source, "")
	writeJSON(response, http.StatusOK, server.loginStatus())
}

func (server *musicServer) loginStatus() loginStatusResponse {
	sources := make(map[string]bool)
	for source, value := range server.cookieSources() {
		if strings.TrimSpace(value) != "" {
			sources[source] = true
		}
	}
	return loginStatusResponse{Sources: sources}
}

func (server *musicServer) handleAudio(response http.ResponseWriter, request *http.Request) {
	if !server.matchesToken(request.URL.Query().Get("token")) {
		writeJSON(response, http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
		return
	}
	trackID := request.PathValue("trackID")
	track, ok := server.loadTrack(trackID)
	if !ok {
		writeJSON(response, http.StatusNotFound, errorResponse{Error: "track expired or not found"})
		return
	}

	response.Header().Set("Cache-Control", "no-store")

	// Chromium requests one song many times: the initial open plus a stream
	// of progressive range requests. Resolving the source URL again on every
	// request both hammers the provider's URL API (its intermittent failures
	// became mid-song 502s that abort playback) and can land on a different
	// CDN file, which breaks Content-Range totals across requests. Reuse one
	// resolved URL per track, and retry once with a fresh URL when the
	// cached one stops working.
	var lastError error
	for attempt := 0; attempt < 2; attempt++ {
		url, err := server.streamURL(trackID, track, attempt > 0)
		if err != nil {
			lastError = err
			continue
		}
		if server.serveAudio(response, request, track.Source, url) {
			return
		}
		lastError = errors.New("upstream stream failed")
	}

	message := "upstream stream failed"
	if lastError != nil {
		message = lastError.Error()
	}
	writeJSON(response, http.StatusBadGateway, errorResponse{Error: message})
}

// streamURL returns the cached upstream URL for a track. It resolves and
// caches a fresh one when the cache is missing or stale, or when the caller
// reports the cached URL failed (forceRefresh).
func (server *musicServer) streamURL(trackID string, song model.Song, forceRefresh bool) (string, error) {
	if !forceRefresh {
		server.trackMu.Lock()
		cached, ok := server.streamURLs[trackID]
		server.trackMu.Unlock()
		if ok && time.Since(cached.resolvedAt) <= streamURLLifetime {
			return cached.url, nil
		}
	}

	download := server.download(song.Source)
	if download == nil {
		return "", errors.New("source does not support playback")
	}
	url, err := download(&song)
	if err != nil || strings.TrimSpace(url) == "" {
		return "", errors.New("failed to resolve audio stream")
	}

	server.trackMu.Lock()
	server.streamURLs[trackID] = cachedStreamURL{url: url, resolvedAt: time.Now()}
	server.trackMu.Unlock()
	return url, nil
}

// serveAudio proxies one upstream fetch onto the response. It reports whether
// the response was committed; when it returns false nothing was written, so
// the caller may retry with a different upstream URL.
func (server *musicServer) serveAudio(response http.ResponseWriter, request *http.Request, source string, url string) bool {
	rangeFetch, handled, rangeErr := core.NewSourceRangeFetch(url, source, request.Header.Get("Range"))
	if rangeErr != nil {
		return false
	}
	if handled {
		copyRangeHeaders(response.Header(), rangeFetch)
		response.WriteHeader(rangeFetch.StatusCode)
		if request.Method == http.MethodHead {
			return true
		}
		_ = rangeFetch.WriteTo(response)
		return true
	}

	upstreamRequest, err := core.BuildSourceRequest(http.MethodGet, url, source, request.Header.Get("Range"))
	if err != nil {
		return false
	}
	upstreamRequest = upstreamRequest.WithContext(request.Context())
	upstreamResponse, err := (&http.Client{}).Do(upstreamRequest)
	if err != nil {
		return false
	}
	defer upstreamResponse.Body.Close()
	// An upstream error status usually means the resolved URL went stale;
	// leaving the response untouched lets the caller retry a fresh URL.
	if upstreamResponse.StatusCode >= http.StatusBadRequest {
		return false
	}

	copyUpstreamHeaders(response.Header(), upstreamResponse.Header)
	response.WriteHeader(upstreamResponse.StatusCode)
	if request.Method == http.MethodHead {
		return true
	}
	_, _ = io.Copy(response, upstreamResponse.Body)
	return true
}

func (server *musicServer) storeTrack(trackID string, song model.Song) {
	server.trackMu.Lock()
	defer server.trackMu.Unlock()

	now := time.Now()
	for id, track := range server.tracks {
		if now.Sub(track.createdAt) > trackLifetime {
			delete(server.tracks, id)
			delete(server.streamURLs, id)
		}
	}
	if len(server.tracks) >= maxStoredTracks {
		var oldestID string
		var oldestTime time.Time
		for id, track := range server.tracks {
			if oldestID == "" || track.createdAt.Before(oldestTime) {
				oldestID = id
				oldestTime = track.createdAt
			}
		}
		delete(server.tracks, oldestID)
		delete(server.streamURLs, oldestID)
	}
	server.tracks[trackID] = storedTrack{song: song, createdAt: now}
}

func (server *musicServer) loadTrack(trackID string) (model.Song, bool) {
	server.trackMu.Lock()
	defer server.trackMu.Unlock()

	track, ok := server.tracks[trackID]
	if !ok {
		return model.Song{}, false
	}
	if time.Since(track.createdAt) > trackLifetime {
		delete(server.tracks, trackID)
		delete(server.streamURLs, trackID)
		return model.Song{}, false
	}
	return track.song, true
}

func randomID() (string, error) {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func copyRangeHeaders(header http.Header, fetch *core.SourceRangeFetch) {
	contentType := strings.TrimSpace(fetch.ContentType)
	if contentType == "" {
		contentType = core.AudioMimeByExt(fetch.Ext)
	}
	header.Set("Content-Type", contentType)
	header.Set("Accept-Ranges", "bytes")
	header.Set("Content-Length", strconv.FormatInt(fetch.ContentLength, 10))
	if fetch.ContentRange != "" {
		header.Set("Content-Range", fetch.ContentRange)
	}
}

func copyUpstreamHeaders(target http.Header, source http.Header) {
	for _, name := range []string{"Accept-Ranges", "Content-Length", "Content-Range", "Content-Type", "ETag", "Last-Modified"} {
		if value := source.Get(name); value != "" {
			target.Set(name, value)
		}
	}
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
