package universal

import (
	"encoding/json"
	"testing"
)

func TestChatMessageJSONCarriesLevelFields(t *testing.T) {
	raw, err := json.Marshal(ChatMessage{Name: "Neko", Content: "hi", Level: 6, MedalLevel: 12})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if m["level"] != float64(6) {
		t.Errorf("level = %v, want 6", m["level"])
	}
	if m["medalLevel"] != float64(12) {
		t.Errorf("medalLevel = %v, want 12", m["medalLevel"])
	}
}

func TestChatMessageJSONOmitsZeroLevels(t *testing.T) {
	raw, err := json.Marshal(ChatMessage{Name: "Neko", Content: "hi"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := m["level"]; ok {
		t.Errorf("level should be omitted when zero, got %v", m["level"])
	}
	if _, ok := m["medalLevel"]; ok {
		t.Errorf("medalLevel should be omitted when zero, got %v", m["medalLevel"])
	}
}
