package main

import (
  "encoding/json"
  "fmt"
  "os"
)

const fingerprintTarget = 3

func mustDecode[T any](b []byte) T {
  var result T
  if err := json.Unmarshal(b, &result); err != nil { panic(err) }
  return result
}

func main() {
  var inputs []fingerprintOutput
  if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil {
    fmt.Fprintln(os.Stderr, err)
    os.Exit(2)
  }
  result, err := analyzeFingerprint(inputs)
  if err != nil {
    fmt.Fprintln(os.Stderr, err)
    os.Exit(1)
  }
  if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
    fmt.Fprintln(os.Stderr, err)
    os.Exit(2)
  }
}
