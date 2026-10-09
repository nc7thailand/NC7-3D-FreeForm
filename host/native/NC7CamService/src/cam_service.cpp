#include "cam_service.hpp"

#include "base64.hpp"
#include "json_mini.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <utility>
#include <vector>

namespace nc7 {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kFloorEpsilon = 1e-6;
constexpr double kPlaneEpsilon = 1e-7;

struct Vec3 {
  double x = 0;
  double y = 0;
  double z = 0;
};

struct Uv {
  double u = 0;
  double v = 0;
};

struct Mesh {
  std::string uuid;
  bool hasUuid = false;
  double revision = 0;
  std::vector<double> xyz;
  int triangleCount = 0;
};

Json channelField() { return Json::str(CamService::kChannel); }

std::string lineOf(const Json& value) {
  std::string out = stringifyJson(value);
  out.push_back('\n');
  return out;
}

Json errorMessage(const Json& id, const std::string& error) {
  return obj({
      {"channel", channelField()},
      {"id", id},
      {"type", Json::str("result")},
      {"status", Json::str("error")},
      {"protocolVersion", Json::number(CamService::kProtocolVersion)},
      {"engine", Json::str(CamService::kEngine)},
      {"error", Json::str(error)},
  });
}

Json vec3Json(Vec3 v) {
  return obj({
      {"x", Json::number(v.x)},
      {"y", Json::number(v.y)},
      {"z", Json::number(v.z)},
  });
}

Json uvJson(Uv p) {
  return obj({
      {"u", Json::number(p.u)},
      {"v", Json::number(p.v)},
  });
}

std::vector<double> floatsFromLeBytes(const std::vector<std::uint8_t>& bytes) {
  if (bytes.size() % 4 != 0) {
    throw std::runtime_error("position byte length is not a multiple of 4");
  }
  std::vector<double> out(bytes.size() / 4);
  for (std::size_t i = 0; i < out.size(); ++i) {
    const std::uint32_t bits = static_cast<std::uint32_t>(bytes[i * 4]) |
                               (static_cast<std::uint32_t>(bytes[i * 4 + 1]) << 8) |
                               (static_cast<std::uint32_t>(bytes[i * 4 + 2]) << 16) |
                               (static_cast<std::uint32_t>(bytes[i * 4 + 3]) << 24);
    float value = 0;
    static_assert(sizeof(float) == 4, "float32 required");
    std::memcpy(&value, &bits, sizeof(value));
    out[i] = static_cast<double>(value);
  }
  return out;
}

std::vector<std::uint32_t> uintsFromLeBytes(const std::vector<std::uint8_t>& bytes) {
  if (bytes.size() % 4 != 0) {
    throw std::runtime_error("index byte length is not a multiple of 4");
  }
  std::vector<std::uint32_t> out(bytes.size() / 4);
  for (std::size_t i = 0; i < out.size(); ++i) {
    out[i] = static_cast<std::uint32_t>(bytes[i * 4]) |
             (static_cast<std::uint32_t>(bytes[i * 4 + 1]) << 8) |
             (static_cast<std::uint32_t>(bytes[i * 4 + 2]) << 16) |
             (static_cast<std::uint32_t>(bytes[i * 4 + 3]) << 24);
  }
  return out;
}

void expectCount(const Json& geometry, const char* key, std::size_t actual) {
  const Json* count = geometry.find(key);
  if (!count) return;
  if (!count->isNumber() || !std::isfinite(count->n)) {
    throw std::runtime_error(std::string(key) + " must be a finite number");
  }
  if (static_cast<std::size_t>(std::llround(count->n)) != actual) {
    throw std::runtime_error(std::string(key) + " does not match the decoded buffer");
  }
}

std::vector<double> readPosition(const Json& geometry) {
  const Json* position = geometry.find("position");
  if (!position || position->isNull()) return {};
  const Json* encoding = geometry.find("positionEncoding");
  std::vector<double> xyz;
  if (encoding && encoding->isString()) {
    if (encoding->s != "base64-f32le") {
      throw std::runtime_error("unsupported positionEncoding");
    }
    if (!position->isString()) throw std::runtime_error("base64 position must be a string");
    xyz = floatsFromLeBytes(decodeBase64(position->s));
  } else if (position->isArray()) {
    xyz.reserve(position->a.size());
    for (const Json& value : position->a) {
      if (!value.isNumber() || !std::isfinite(value.n)) {
        throw std::runtime_error("position values must be finite numbers");
      }
      xyz.push_back(value.n);
    }
  } else {
    throw std::runtime_error("position must be a number array or base64-f32le string");
  }
  expectCount(geometry, "positionCount", xyz.size());
  if (!xyz.empty() && xyz.size() % 3 != 0) {
    throw std::runtime_error("position length must be a multiple of 3");
  }
  return xyz;
}

int readTriangleCount(const Json& geometry, std::size_t vertexCount) {
  const Json* index = geometry.find("index");
  if (!index || index->isNull()) return static_cast<int>(vertexCount / 3);
  const Json* encoding = geometry.find("indexEncoding");
  std::vector<std::uint32_t> indices;
  if (encoding && encoding->isString()) {
    if (encoding->s != "base64-u32le") throw std::runtime_error("unsupported indexEncoding");
    if (!index->isString()) throw std::runtime_error("base64 index must be a string");
    indices = uintsFromLeBytes(decodeBase64(index->s));
  } else if (index->isArray()) {
    indices.reserve(index->a.size());
    for (const Json& value : index->a) {
      if (!value.isNumber() || !std::isfinite(value.n) || value.n < 0 || std::floor(value.n) != value.n) {
        throw std::runtime_error("index values must be non-negative integers");
      }
      indices.push_back(static_cast<std::uint32_t>(value.n));
    }
  } else {
    throw std::runtime_error("index must be a number array or base64-u32le string");
  }
  expectCount(geometry, "indexCount", indices.size());
  if (indices.size() % 3 != 0) throw std::runtime_error("index length must be a multiple of 3");
  for (std::uint32_t idx : indices) {
    if (static_cast<std::size_t>(idx) >= vertexCount) throw std::runtime_error("index out of range");
  }
  return static_cast<int>(indices.size() / 3);
}

void floorSettle(std::vector<double>& xyz) {
  double minY = std::numeric_limits<double>::infinity();
  for (std::size_t i = 1; i < xyz.size(); i += 3) {
    if (std::isfinite(xyz[i])) minY = std::min(minY, xyz[i]);
  }
  if (!(minY < -kFloorEpsilon)) return;
  const double shift = -minY;
  for (std::size_t i = 1; i < xyz.size(); i += 3) xyz[i] += shift;
}

Mesh decodeMesh(const Json* geometry) {
  Mesh mesh;
  if (!geometry || geometry->isNull()) return mesh;
  if (!geometry->isObject()) throw std::runtime_error("geometry must be an object");
  if (const Json* uuid = geometry->find("uuid")) {
    if (uuid->isString()) {
      mesh.uuid = uuid->s;
      mesh.hasUuid = true;
    } else if (!uuid->isNull()) {
      throw std::runtime_error("geometry.uuid must be a string");
    }
  }
  if (const Json* userData = geometry->find("userData")) {
    if (userData->isObject()) {
      if (const Json* revision = userData->find("nc7ModelRevision")) {
        if (revision->isNumber() && std::isfinite(revision->n)) mesh.revision = revision->n;
      }
    }
  }
  mesh.xyz = readPosition(*geometry);
  if (mesh.xyz.empty()) return mesh;
  mesh.triangleCount = readTriangleCount(*geometry, mesh.xyz.size() / 3);
  floorSettle(mesh.xyz);
  return mesh;
}

int clampRotationN(double n) {
  if (!std::isfinite(n)) throw std::runtime_error("rotationN must be a finite number");
  int rounded = static_cast<int>(std::lround(n));
  if (rounded < 3) rounded = 3;
  if (rounded > 64) rounded = 64;
  return rounded;
}

int effectiveCutCount(int rotationN, bool leftOnly) {
  if (leftOnly) return rotationN;
  const int count = rotationN / 2;
  return count < 2 ? 2 : count;
}

Vec3 planePointFrom(const Json& payload, const Json* stock) {
  if (const Json* point = payload.find("planePoint")) {
    if (point->isArray()) {
      if (point->a.size() != 3 || !point->a[0].isNumber() || !point->a[1].isNumber() || !point->a[2].isNumber()) {
        throw std::runtime_error("planePoint must be [x, y, z]");
      }
      return {point->a[0].n, point->a[1].n, point->a[2].n};
    }
    if (point->isObject()) {
      const Json* x = point->find("x");
      const Json* y = point->find("y");
      const Json* z = point->find("z");
      if (!x || !y || !z || !x->isNumber() || !y->isNumber() || !z->isNumber()) {
        throw std::runtime_error("planePoint must be [x, y, z]");
      }
      return {x->n, y->n, z->n};
    }
    throw std::runtime_error("planePoint must be [x, y, z]");
  }
  double thickness = 0;
  if (stock && stock->isObject()) {
    if (const Json* t = stock->find("t")) {
      if (t->isNumber() && std::isfinite(t->n)) thickness = t->n;
    }
  }
  return {0, 0, -thickness / 2.0};
}

bool leftOnlyMode(const Json* cutMode) {
  if (!cutMode || cutMode->isNull()) return false;
  if (!cutMode->isString()) throw std::runtime_error("cutMode must be a string");
  return cutMode->s == "left-only";
}

double cross(Uv o, Uv a, Uv b) {
  return (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
}

std::vector<Uv> convexHull(std::vector<Uv> points) {
  std::sort(points.begin(), points.end(), [](Uv a, Uv b) {
    if (a.u != b.u) return a.u < b.u;
    return a.v < b.v;
  });
  points.erase(std::unique(points.begin(), points.end(), [](Uv a, Uv b) {
                 return a.u == b.u && a.v == b.v;
               }),
               points.end());
  if (points.size() <= 2) return points;

  std::vector<Uv> lower;
  std::vector<Uv> upper;
  for (const Uv& point : points) {
    while (lower.size() >= 2 && cross(lower[lower.size() - 2], lower.back(), point) <= 0) lower.pop_back();
    lower.push_back(point);
  }
  for (std::size_t i = points.size(); i-- > 0;) {
    const Uv& point = points[i];
    while (upper.size() >= 2 && cross(upper[upper.size() - 2], upper.back(), point) <= 0) upper.pop_back();
    upper.push_back(point);
  }
  lower.pop_back();
  upper.pop_back();
  lower.insert(lower.end(), upper.begin(), upper.end());
  return lower;
}

std::vector<Uv> projectVertices(const std::vector<double>& xyz, Vec3 point, Vec3 uAxis) {
  std::vector<Uv> projected;
  projected.reserve(xyz.size() / 3);
  for (std::size_t i = 0; i + 2 < xyz.size(); i += 3) {
    const double x = xyz[i];
    const double y = xyz[i + 1];
    const double z = xyz[i + 2];
    if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) continue;
    const double dx = x - point.x;
    const double dz = z - point.z;
    projected.push_back({dx * uAxis.x + dz * uAxis.z, y - point.y});
  }
  return projected;
}

std::vector<Uv> leftProfileOf(const std::vector<Uv>& unique, const std::vector<Uv>& hull) {
  std::vector<Uv> left;
  for (const Uv& point : hull) {
    if (point.u <= kPlaneEpsilon) left.push_back(point);
  }
  if (left.size() < 2 && unique.size() >= 2) {
    std::vector<Uv> byU = unique;
    std::sort(byU.begin(), byU.end(), [](Uv a, Uv b) {
      if (a.u != b.u) return a.u < b.u;
      return a.v > b.v;
    });
    left.clear();
    left.push_back(byU[0]);
    left.push_back(byU[1]);
  }
  std::sort(left.begin(), left.end(), [](Uv a, Uv b) {
    if (a.v != b.v) return a.v > b.v;
    return a.u < b.u;
  });
  left.erase(std::unique(left.begin(), left.end(), [](Uv a, Uv b) {
               return a.u == b.u && a.v == b.v;
             }),
             left.end());
  return left;
}

Json polylineJson(const std::vector<Uv>& points) {
  std::vector<Json> coords;
  coords.reserve(points.size());
  for (const Uv& point : points) coords.push_back(uvJson(point));
  return Json::array(std::move(coords));
}

Json profileJson(const std::vector<Uv>& polyline, Vec3 normal, Vec3 uAxis, Vec3 point) {
  std::vector<Json> polylines;
  if (polyline.size() >= 2) polylines.push_back(polylineJson(polyline));
  return obj({
      {"polylines", Json::array(std::move(polylines))},
      {"pointCount", Json::number(static_cast<double>(polyline.size() >= 2 ? polyline.size() : 0))},
      {"frame", obj({
                     {"normal", vec3Json(normal)},
                     {"uAxis", vec3Json(uAxis)},
                     {"point", vec3Json(point)},
                 })},
      {"source", Json::str("native-skeleton")},
  });
}

void writeLine(std::ostream& out, const Json& value) {
  out << stringifyJson(value) << '\n' << std::flush;
}

std::string computeToolpath(const Json& root, const Json& id, std::ostream& progressOut) {
  const Json* payload = root.find("payload");
  if (!payload || !payload->isObject()) throw std::runtime_error("payload must be an object");
  const Json* rotation = payload->find("rotationN");
  if (!rotation || !rotation->isNumber()) throw std::runtime_error("rotationN must be a number");
  const bool leftOnly = leftOnlyMode(payload->find("cutMode"));
  const int rotationN = clampRotationN(rotation->n);
  const int cutCount = effectiveCutCount(rotationN, leftOnly);
  const char* mode = leftOnly ? "left-only" : "left-to-right";
  const Json* stock = payload->find("stock");
  if (stock && !stock->isObject() && !stock->isNull()) throw std::runtime_error("stock must be an object");
  const Vec3 planePoint = planePointFrom(*payload, stock && stock->isObject() ? stock : nullptr);
  const Mesh mesh = decodeMesh(payload->find("geometry"));

  if (mesh.xyz.empty()) {
    return lineOf(obj({
        {"channel", channelField()},
        {"id", id},
        {"type", Json::str("result")},
        {"status", Json::str("success")},
        {"protocolVersion", Json::number(CamService::kProtocolVersion)},
        {"engine", Json::str(CamService::kEngine)},
        {"engineVersion", Json::str(CamService::kVersion)},
        {"vertexCount", Json::number(0)},
        {"triangleCount", Json::number(0)},
        {"cutJob", Json::nul()},
    }));
  }

  std::vector<Json> cuts;
  cuts.reserve(static_cast<std::size_t>(cutCount));
  for (int index = 0; index < cutCount; ++index) {
    const double thetaDeg = index * (360.0 / static_cast<double>(cutCount));
    const double radians = thetaDeg * kPi / 180.0;
    const double sn = std::sin(radians);
    const double cs = std::cos(radians);
    const Vec3 normal{sn, 0, cs};
    const Vec3 uAxis{cs, 0, -sn};
    const std::vector<Uv> projected = projectVertices(mesh.xyz, planePoint, uAxis);
    const std::vector<Uv> hull = convexHull(projected);
    const std::vector<Uv> left = leftProfileOf(projected, hull);
    std::vector<Uv> overlay = hull;
    if (overlay.size() >= 2) overlay.push_back(overlay.front());
    else overlay = left;

    cuts.push_back(obj({
        {"index", Json::number(index)},
        {"thetaDeg", Json::number(thetaDeg)},
        {"profile", profileJson(left, normal, uAxis, planePoint)},
        {"overlayContour", polylineJson(overlay)},
    }));
    writeLine(progressOut, obj({
                              {"channel", channelField()},
                              {"id", id},
                              {"type", Json::str("progress")},
                              {"protocolVersion", Json::number(CamService::kProtocolVersion)},
                              {"done", Json::number(index + 1)},
                              {"total", Json::number(cutCount)},
                          }));
  }

  Json stockJson = stock && stock->isObject() ? *stock : Json::object();
  Json uuidJson = mesh.hasUuid ? Json::str(mesh.uuid) : Json::nul();
  return lineOf(obj({
      {"channel", channelField()},
      {"id", id},
      {"type", Json::str("result")},
      {"status", Json::str("success")},
      {"protocolVersion", Json::number(CamService::kProtocolVersion)},
      {"engine", Json::str(CamService::kEngine)},
      {"engineVersion", Json::str(CamService::kVersion)},
      {"vertexCount", Json::number(static_cast<double>(mesh.xyz.size() / 3))},
      {"triangleCount", Json::number(mesh.triangleCount)},
      {"cutJob",
       obj({
           {"rotationN", Json::number(rotationN)},
           {"cutCount", Json::number(cutCount)},
           {"mode", Json::str(mode)},
           {"cuts", Json::array(std::move(cuts))},
           {"stock", std::move(stockJson)},
           {"sourceGeometryUuid", std::move(uuidJson)},
           {"sourceModelRevision", Json::number(mesh.revision)},
           {"overlayContourVersion", Json::number(CamService::kOverlayContourVersion)},
       })},
  }));
}

}  // namespace

std::string CamService::helloLine() const {
  return lineOf(obj({
      {"channel", channelField()},
      {"type", Json::str("hello")},
      {"protocolVersion", Json::number(kProtocolVersion)},
      {"engine", Json::str(kEngine)},
      {"engineVersion", Json::str(kVersion)},
      {"productionReady", Json::boolean(false)},
      {"actions", Json::array({
                       Json::str("hello"),
                       Json::str("ping"),
                       Json::str("computeToolpath"),
                   })},
  }));
}

std::string CamService::handle(const std::string& line, std::ostream& progressOut) {
  Json id = Json::nul();
  try {
    if (line.size() > kMaxMessageBytes) throw std::runtime_error("CAM request exceeds 256 MB");
    const Json root = parseJson(line);
    if (!root.isObject()) throw std::runtime_error("CAM request must be a JSON object");
    if (const Json* requestId = root.find("id")) id = *requestId;
    const Json* action = root.find("action");
    if (!action || !action->isString() || action->s.empty()) {
      throw std::runtime_error("action must be a string");
    }
    if (action->s == "hello") return helloLine();
    if (action->s == "ping") {
      return lineOf(obj({
          {"channel", channelField()},
          {"id", id},
          {"type", Json::str("result")},
          {"status", Json::str("success")},
          {"protocolVersion", Json::number(kProtocolVersion)},
          {"engine", Json::str(kEngine)},
          {"pong", Json::boolean(true)},
      }));
    }
    if (action->s == "computeToolpath") return computeToolpath(root, id, progressOut);
    throw std::runtime_error("Unknown action: " + action->s);
  } catch (const std::exception& ex) {
    return lineOf(errorMessage(id, ex.what()));
  }
}

}  // namespace nc7
