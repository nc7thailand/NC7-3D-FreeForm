#pragma once

#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace nc7 {

inline int base64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

inline std::vector<std::uint8_t> decodeBase64(const std::string& input) {
  std::string clean;
  clean.reserve(input.size());
  for (char c : input) {
    if (c == '\n' || c == '\r' || c == ' ' || c == '\t') continue;
    clean.push_back(c);
  }
  if (clean.size() % 4 != 0) throw std::runtime_error("invalid base64 length");

  std::vector<std::uint8_t> out;
  out.reserve(clean.size() / 4 * 3);
  for (std::size_t i = 0; i < clean.size(); i += 4) {
    const int v0 = base64Value(clean[i]);
    const int v1 = base64Value(clean[i + 1]);
    if (v0 < 0 || v1 < 0) throw std::runtime_error("invalid base64");
    const bool pad2 = clean[i + 2] == '=';
    const bool pad3 = clean[i + 3] == '=';
    if (pad2 && !pad3) throw std::runtime_error("invalid base64 padding");
    const int v2 = pad2 ? 0 : base64Value(clean[i + 2]);
    const int v3 = pad3 ? 0 : base64Value(clean[i + 3]);
    if (v2 < 0 || v3 < 0) throw std::runtime_error("invalid base64");
    const int triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    out.push_back(static_cast<std::uint8_t>((triple >> 16) & 0xFF));
    if (!pad2) out.push_back(static_cast<std::uint8_t>((triple >> 8) & 0xFF));
    if (!pad3) out.push_back(static_cast<std::uint8_t>(triple & 0xFF));
  }
  return out;
}

}  // namespace nc7
