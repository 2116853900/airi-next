package main

import (
	"context"
	"errors"
	"testing"

	"github.com/guohuiyuan/music-lib/model"
)

func TestMusicResolverRejectsEmptyQuery(t *testing.T) {
	resolver := &musicResolver{}

	_, err := resolver.resolve(context.Background(), "  ")
	if err == nil || err.Error() != "query is required" {
		t.Fatalf("resolve() error = %v, want query is required", err)
	}
}

func TestMusicResolverReturnsFirstPlayableCandidateByRank(t *testing.T) {
	resolver := &musicResolver{
		sources: []string{"first", "second"},
		search: func(_ context.Context, source string, _ string) ([]model.Song, error) {
			return []model.Song{{ID: source, Name: "Test Song", Artist: "Artist"}}, nil
		},
		validate: func(_ context.Context, song model.Song) bool {
			return song.ID == "second"
		},
	}

	song, err := resolver.resolve(context.Background(), "Test Song Artist")
	if err != nil {
		t.Fatalf("resolve() error = %v", err)
	}
	if song.ID != "second" || song.Source != "second" {
		t.Fatalf("resolve() song = %#v, want second source", song)
	}
}

func TestMusicResolverPrefersFullLengthOverTrialClip(t *testing.T) {
	resolver := &musicResolver{
		sources: []string{"first", "second"},
		search: func(_ context.Context, source string, _ string) ([]model.Song, error) {
			if source == "first" {
				return []model.Song{{ID: "clip", Name: "Test Song", Artist: "Artist", Duration: 59}}, nil
			}
			return []model.Song{{ID: "full", Name: "Test Song", Artist: "Artist", Duration: 320}}, nil
		},
		validate: func(_ context.Context, _ model.Song) bool { return true },
	}

	// ROOT CAUSE:
	//
	// Free provider tiers list ~60s trial clips next to the full recording
	// with identical name and artist, so text similarity ties and the source
	// rank tiebreak picked the clip. Playback then ended after one minute.
	//
	// We fixed this by penalizing sub-90s candidates so an equally matching
	// full-length recording from any source outranks the clip.
	song, err := resolver.resolve(context.Background(), "Test Song Artist")
	if err != nil {
		t.Fatalf("resolve() error = %v", err)
	}
	if song.ID != "full" {
		t.Fatalf("resolve() song = %#v, want the full-length candidate", song)
	}
}

func TestVariantMarkerPenalty(t *testing.T) {
	if penalty := variantMarkerPenalty("周杰伦 晴天", "晴天 (DJ版)"); penalty != variantVersionPenalty {
		t.Fatalf("variantMarkerPenalty(dj version) = %v, want %v", penalty, variantVersionPenalty)
	}
	if penalty := variantMarkerPenalty("晴天 dj版", "晴天 (DJ版)"); penalty != 0 {
		t.Fatalf("variantMarkerPenalty(query asks for dj version) = %v, want 0", penalty)
	}
	if penalty := variantMarkerPenalty("Alive", "Alive"); penalty != 0 {
		t.Fatalf("variantMarkerPenalty(plain title) = %v, want 0", penalty)
	}
}

func TestMusicResolverContinuesWhenOneSourceFails(t *testing.T) {
	resolver := &musicResolver{
		sources: []string{"failed", "working"},
		search: func(_ context.Context, source string, _ string) ([]model.Song, error) {
			if source == "failed" {
				return nil, errors.New("search failed")
			}
			return []model.Song{{ID: "track", Name: "Playable", Artist: "Artist"}}, nil
		},
		validate: func(_ context.Context, _ model.Song) bool { return true },
	}

	song, err := resolver.resolve(context.Background(), "Playable")
	if err != nil {
		t.Fatalf("resolve() error = %v", err)
	}
	if song.ID != "track" || song.Source != "working" {
		t.Fatalf("resolve() song = %#v, want working source", song)
	}
}
