#pragma once

#include <iosfwd>
#include <string>

namespace nc7 {

// Native CAM process. Protocol is one JSON object per line on stdin/stdout.
// This build is a skeleton: cut angles and cutting-plane frames match the JS
// worker, and each profile is the convex hull of the projected vertices.
// It is not the production silhouette raster. Callers must keep using the
// JS worker until a later engine sets productionReady.
class CamService {
 public:
  static constexpr const char* kChannel = "nc7-cam";
  static constexpr const char* kEngine = "native-skeleton";
  static constexpr const char* kVersion = "0.1.0";
  static constexpr int kProtocolVersion = 1;
  static constexpr int kOverlayContourVersion = 2;
  static constexpr std::size_t kMaxMessageBytes = 256ull * 1024ull * 1024ull;

  std::string helloLine() const;

  // Progress lines are written to `progressOut` as they happen.
  // The returned result line includes its trailing newline.
  std::string handle(const std::string& line, std::ostream& progressOut);
};

}  // namespace nc7
