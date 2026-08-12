package main

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/guohuiyuan/go-music-dl/core"
	"github.com/guohuiyuan/music-lib/model"
)

const (
	searchTimeout          = 6 * time.Second
	maxCandidatesPerSource = 8
	maxValidatedCandidates = 12
	validationWorkers      = 6

	// Similarity scores range 0..1 (core.CalcSongSimilarity). These penalties
	// demote suspicious candidates below clean full-length matches from other
	// sources without excluding them, so they stay playable as a last resort.
	//
	// Free tiers of the providers list trial clips and ringtones (often ~60s)
	// next to the full recording; anything shorter than shortClipSeconds is
	// almost never the requested song.
	shortClipPenalty = 0.25
	shortClipSeconds = 90
	// Uploads whose title carries a variant marker (DJ edit, remix, cover,
	// live cut...) rank high on text similarity because they embed the plain
	// song name, but they are not the recording the viewer asked for.
	variantVersionPenalty = 0.15
)

type variantMarker struct {
	// pattern matches the candidate title. Bracketed or suffixed forms avoid
	// matching inside ordinary words (e.g. "live" inside "Alive").
	pattern string
	// core matches the query when the viewer explicitly asks for the
	// variant, which lifts the penalty regardless of the surface form the
	// candidate title uses.
	core string
}

var variantMarkers = []variantMarker{
	{pattern: "dj版", core: "dj"},
	{pattern: "(dj", core: "dj"},
	{pattern: "（dj", core: "dj"},
	{pattern: "remix", core: "remix"},
	{pattern: "翻自", core: "翻自"},
	{pattern: "伴奏", core: "伴奏"},
	{pattern: "纯音乐", core: "纯音乐"},
	{pattern: "铃声", core: "铃声"},
	{pattern: "试听", core: "试听"},
	{pattern: "片段", core: "片段"},
	{pattern: "现场版", core: "现场"},
	{pattern: "(live", core: "live"},
	{pattern: "（live", core: "live"},
	{pattern: "(cover", core: "cover"},
	{pattern: "（cover", core: "cover"},
}

// variantMarkerPenalty penalizes candidate titles that advertise a different
// recording than the plain song, unless the query itself asks for it.
func variantMarkerPenalty(query string, candidateName string) float64 {
	name := strings.ToLower(candidateName)
	loweredQuery := strings.ToLower(query)
	for _, marker := range variantMarkers {
		if strings.Contains(name, marker.pattern) && !strings.Contains(loweredQuery, marker.core) {
			return variantVersionPenalty
		}
	}
	return 0
}

var errNoPlayableTrack = errors.New("no playable track matched the query")

type searchProvider func(context.Context, string, string) ([]model.Song, error)
type playableValidator func(context.Context, model.Song) bool

type musicResolver struct {
	sources  []string
	search   searchProvider
	validate playableValidator
}

type songCandidate struct {
	song       model.Song
	score      float64
	sourceRank int
	resultRank int
}

type sourceSearchResult struct {
	sourceRank int
	songs      []model.Song
}

func newMusicResolver() *musicResolver {
	sources := make([]string, 0)
	for _, source := range core.GetDefaultSourceNames() {
		if source == "soda" || source == "fivesing" || source == "local" || source == "local-file" {
			continue
		}
		if core.GetSearchFunc(source) != nil {
			sources = append(sources, source)
		}
	}

	return &musicResolver{
		sources:  sources,
		search:   searchSource,
		validate: validatePlayable,
	}
}

func (resolver *musicResolver) resolve(ctx context.Context, query string) (model.Song, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return model.Song{}, errors.New("query is required")
	}

	results := make(chan sourceSearchResult, len(resolver.sources))
	var searchGroup sync.WaitGroup
	for sourceRank, source := range resolver.sources {
		searchGroup.Add(1)
		go func() {
			defer searchGroup.Done()
			songs, err := resolver.search(ctx, source, query)
			if err == nil && len(songs) > 0 {
				results <- sourceSearchResult{sourceRank: sourceRank, songs: songs}
			}
		}()
	}
	go func() {
		searchGroup.Wait()
		close(results)
	}()

	var candidates []songCandidate
	for result := range results {
		limit := min(len(result.songs), maxCandidatesPerSource)
		for resultRank := 0; resultRank < limit; resultRank++ {
			song := result.songs[resultRank]
			// The provider that returned the candidate also owns its download path.
			song.Source = resolver.sources[result.sourceRank]
			score := max(
				core.CalcSongSimilarity(query, "", song.Name, song.Artist),
				core.CalcSongSimilarity(query, "", song.Name+" "+song.Artist, ""),
			)
			if score <= 0 {
				continue
			}
			score -= variantMarkerPenalty(query, song.Name)
			if song.Duration > 0 && song.Duration < shortClipSeconds {
				score -= shortClipPenalty
			}
			candidates = append(candidates, songCandidate{
				song:       song,
				score:      score,
				sourceRank: result.sourceRank,
				resultRank: resultRank,
			})
		}
	}
	if len(candidates) == 0 {
		return model.Song{}, errNoPlayableTrack
	}

	sort.SliceStable(candidates, func(left, right int) bool {
		if candidates[left].score != candidates[right].score {
			return candidates[left].score > candidates[right].score
		}
		if candidates[left].sourceRank != candidates[right].sourceRank {
			return candidates[left].sourceRank < candidates[right].sourceRank
		}
		return candidates[left].resultRank < candidates[right].resultRank
	})

	limit := min(len(candidates), maxValidatedCandidates)
	valid := make([]bool, limit)
	jobs := make(chan int, limit)
	var validationGroup sync.WaitGroup
	workerCount := min(validationWorkers, limit)
	for range workerCount {
		validationGroup.Add(1)
		go func() {
			defer validationGroup.Done()
			for index := range jobs {
				valid[index] = resolver.validate(ctx, candidates[index].song)
			}
		}()
	}
	for index := range limit {
		jobs <- index
	}
	close(jobs)
	validationGroup.Wait()

	for index, isValid := range valid {
		if isValid {
			return candidates[index].song, nil
		}
	}
	return model.Song{}, errNoPlayableTrack
}

func searchSource(ctx context.Context, source string, query string) ([]model.Song, error) {
	search := core.GetSearchFunc(source)
	if search == nil {
		return nil, errors.New("source does not support search")
	}

	type result struct {
		songs []model.Song
		err   error
	}
	done := make(chan result, 1)
	go func() {
		songs, err := search(query)
		done <- result{songs: songs, err: err}
	}()

	requestContext, cancel := context.WithTimeout(ctx, searchTimeout)
	defer cancel()
	select {
	case <-requestContext.Done():
		return nil, requestContext.Err()
	case response := <-done:
		for index := range response.songs {
			response.songs[index].Source = source
		}
		return response.songs, response.err
	}
}

func validatePlayable(ctx context.Context, song model.Song) bool {
	download := core.GetDownloadFunc(song.Source)
	if download == nil {
		return false
	}
	url, err := download(&song)
	if err != nil || strings.TrimSpace(url) == "" {
		return false
	}

	request, err := core.BuildSourceRequest(http.MethodGet, url, song.Source, "bytes=0-1")
	if err != nil {
		return false
	}
	request = request.WithContext(ctx)
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == http.StatusOK || response.StatusCode == http.StatusPartialContent
}
