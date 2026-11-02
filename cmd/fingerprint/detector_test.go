package main

import "testing"

func TestParseNumbers(t *testing.T) {
  got := parseNumbers("1, 20, 355, 400, 20")
  if len(got) != 4 { t.Fatalf("got %v", got) }
}
func TestDetectorLoads(t *testing.T) {
  if len(sharedDetector.ModelIDs) == 0 { t.Fatal("no models") }
  if len(detectorRevision) < 10 { t.Fatal("no revision") }
}
